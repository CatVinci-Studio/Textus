import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

/**
 * The writer edits the text a rewrite proposes to change, before deciding
 * on it - or while it is still streaming in. Their edit always stands: a
 * change whose original sentence they touched is set aside (and back on
 * undo), every other change stays and is applied as it was; the rest of
 * the paragraph is never written over. It used to drop the whole proposal
 * the moment any character in its paragraph changed.
 */

const editor = '[data-active-tab="true"] .ProseMirror';
// Two of five sentences changed: decided sentence by sentence.
const NOTE =
  "这一句其实是在呼应第一回，可以说是一个起点。宝玉初见黛玉便觉似曾相识。贾母一句胡说，轻轻带过。黛玉也不说破。二人从此相识。";
const REWRITE =
  "这一句呼应第一回，是一个起点。宝玉初见黛玉便觉眼熟。贾母一句胡说，轻轻带过。黛玉也不说破。二人从此相识。";

/** Puts the caret right after `needle` in the document's own text (not in
 *  a proposal's widget) and types `text` there. */
async function typeAfter(page: Page, needle: string, text: string) {
  await page.evaluate(
    ({ selector, needle }) => {
      const root = document.querySelector(selector)!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if ((n.parentElement as HTMLElement).closest(".pending-insert"))
          continue;
        const i = n.textContent!.indexOf(needle);
        if (i === -1) continue;
        (root as HTMLElement).focus();
        const range = document.createRange();
        range.setStart(n, i + needle.length);
        range.collapse(true);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      throw new Error(`not found: ${needle}`);
    },
    { selector: editor, needle },
  );
  await page.keyboard.type(text);
}

async function propose(page: Page) {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "levis-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, `# 笔记\n\n${NOTE}`);
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "polish" },
      {
        kind: "ToolCall",
        call_id: "r1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: NOTE,
          text: REWRITE,
        }),
      },
      { kind: "ToolResult", call_id: "r1", output: "Edit proposed" },
      { kind: "Assistant", text: "Polished." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Polish this");
  await composer.press("Enter");
  await expect(page.locator(".review-bar-pos")).toContainText("2");
}

const acceptAll = (page: Page) =>
  page.locator(".review-bar").getByRole("button", { name: "Accept" }).click();

test("an edit beside a rewrite's changes keeps them, and Accept leaves the edit", async ({
  page,
}) => {
  await propose(page);
  await typeAfter(page, "黛玉也不说破", "，只是笑");
  // Both changes still there, to decide on.
  await expect(page.locator(".review-bar-pos")).toContainText("2");
  await acceptAll(page);
  await expect(page.locator(`${editor} .pending-sentence`)).toHaveCount(0);
  await expect(page.locator(`${editor} p`)).toHaveText(
    "这一句呼应第一回，是一个起点。宝玉初见黛玉便觉眼熟。贾母一句胡说，轻轻带过。黛玉也不说破，只是笑。二人从此相识。",
  );
});

test("an edit in a changed sentence sets that change aside, keeps the other, and taking the edit back brings it back", async ({
  page,
}) => {
  await propose(page);
  await typeAfter(page, "便觉似曾", "有些");
  // The second change's original is the writer's now: one change left.
  await expect(page.locator(".review-bar-pos")).toContainText("1");
  await expect(page.locator(editor)).not.toContainText("眼熟");
  // Taken back, it is back.
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".review-bar-pos")).toContainText("2");
  await expect(page.locator(editor)).toContainText("眼熟");
  // Edited again and accepted: the first change written, the edit kept.
  await typeAfter(page, "便觉似曾", "有些");
  await expect(page.locator(".review-bar-pos")).toContainText("1");
  await acceptAll(page);
  await expect(page.locator(`${editor} p`)).toHaveText(
    "这一句呼应第一回，是一个起点。宝玉初见黛玉便觉似曾有些相识。贾母一句胡说，轻轻带过。黛玉也不说破。二人从此相识。",
  );
});

test("an edit while a rewrite streams in is kept, and the rewrite still lands around it", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "levis-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, `# 笔记\n\n${NOTE}`);
  // Streams the rewrite, waits for __release, then completes.
  await page.evaluate(
    ({ note, rewrite }) => {
      const w = window as unknown as Record<string, unknown>;
      const internals = w.__TAURI_INTERNALS__ as {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      };
      const original = internals.invoke;
      const args = JSON.stringify({
        action: "replace",
        anchor: note,
        text: rewrite,
      });
      internals.invoke = (cmd, a) => {
        if (cmd !== "ai_agent_message") return original(cmd, a);
        const { message, onEvent } = a as {
          message: string;
          onEvent?: { onmessage?: (event: unknown) => void };
        };
        const send = (event: unknown) => onEvent?.onmessage?.(event);
        const turns = [
          {
            kind: "ToolCall",
            call_id: "s1",
            name: "propose_edit",
            arguments: args,
          },
          { kind: "ToolResult", call_id: "s1", output: "Edit proposed" },
          { kind: "Assistant", text: "Polished." },
        ];
        send({ type: "toolStart", callId: "s1", name: "propose_edit" });
        return new Promise((resolve) => {
          let i = 0;
          const tick = () => {
            if (i < args.length) {
              send({
                type: "toolArgsDelta",
                callId: "s1",
                delta: args.slice(i, i + 8),
              });
              i += 8;
              setTimeout(tick, 10);
              return;
            }
            if (!w.__release) {
              setTimeout(tick, 30);
              return;
            }
            for (const turn of turns) send({ type: "turn", turn });
            resolve([{ kind: "User", text: message }, ...turns]);
          };
          tick();
        });
      };
    },
    { note: NOTE, rewrite: REWRITE },
  );
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Polish this");
  await composer.press("Enter");
  await expect(page.locator(editor)).toContainText("眼熟");
  // While it is held, the writer adds to a sentence it keeps.
  await typeAfter(page, "二人从此相识", "，再未分开");
  await page.evaluate(() => {
    (window as { __release?: boolean }).__release = true;
  });
  await expect(page.locator(".agent-panel-view")).toContainText("Polished.");
  await expect(page.locator(".review-bar-pos")).toContainText("2");
  await acceptAll(page);
  await expect(page.locator(`${editor} p`)).toHaveText(
    "这一句呼应第一回，是一个起点。宝玉初见黛玉便觉眼熟。贾母一句胡说，轻轻带过。黛玉也不说破。二人从此相识，再未分开。",
  );
});
