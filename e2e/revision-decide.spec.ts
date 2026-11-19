import { expect, test, type Page } from "@playwright/test";
import { emit, mockInvoke, openApp, pasteMarkdown } from "./helpers";
import { releaseRevise, streamRevise } from "./revise-mock";

/**
 * The writer decides a rewrite, and edits text it would change. Their edit
 * always stands: only changes whose original they touched are set aside.
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

/** Asks the AI to polish the document; it proposes REWRITE for NOTE.
 *  With `path`, the document is that file, opened from disk. */
async function propose(page: Page, path?: string) {
  await openApp(page, {
    settings: { language: "en", autosave: false },
    storage: { "textus-agent-panel-open": "1" },
  });
  if (path)
    await page.evaluate(
      ({ path, text }) => {
        const w = window as unknown as Record<string, unknown> & {
          __devEmitTauriEvent: (name: string, payload: unknown) => void;
        };
        w.__devFiles = { [path]: text };
        w.__devEmitTauriEvent("tauri://drag-drop", {
          paths: [path],
          position: { x: 0, y: 0 },
        });
      },
      { path, text: `# 笔记\n\n${NOTE}\n` },
    );
  else await pasteMarkdown(page, `# 笔记\n\n${NOTE}`);
  await expect(page.locator(editor)).toContainText(NOTE);
  await ask(page);
}

async function ask(page: Page) {
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
  await expect(changes(page)).toContainText("2 changes");
}

const changes = (page: Page) => page.getByRole("toolbar", { name: "Revision" });
const acceptAll = (page: Page) =>
  changes(page).getByRole("button", { name: "Accept", exact: true }).click();

test("an edit beside a rewrite's changes keeps them, and Accept leaves the edit", async ({
  page,
}) => {
  await propose(page);
  await typeAfter(page, "黛玉也不说破", "，只是笑");
  // Both changes still there, to decide on.
  await expect(changes(page)).toContainText("2 changes");
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
  await expect(changes(page)).toContainText("1 change");
  await expect(page.locator(editor)).not.toContainText("眼熟");
  // Taken back, it is back.
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(changes(page)).toContainText("2 changes");
  await expect(page.locator(editor)).toContainText("眼熟");
  // Edited again and accepted: the first change written, the edit kept.
  await typeAfter(page, "便觉似曾", "有些");
  await expect(changes(page)).toContainText("1 change");
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
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, `# 笔记\n\n${NOTE}`);
  await streamRevise(
    page,
    [{ id: "s1", args: { action: "replace", anchor: NOTE, text: REWRITE } }],
    { chunk: 8, every: 10, hold: "眼熟" },
  );
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Polish this");
  await composer.press("Enter");
  // Held before its end, the paragraph is marked as being rewritten; it
  // lands once it is whole. Another mark inside it draws it in pieces.
  await expect(
    page.locator(".milkdown .pending-reading").first(),
  ).toBeVisible();
  // While it is held, the writer adds to a sentence it keeps.
  await typeAfter(page, "二人从此相识", "，再未分开");
  await releaseRevise(page);
  await expect(page.locator(".agent-panel-view")).toContainText("Tightened.");
  await expect(changes(page)).toContainText("2 changes");
  await acceptAll(page);
  await expect(page.locator(`${editor} p`)).toHaveText(
    "这一句呼应第一回，是一个起点。宝玉初见黛玉便觉眼熟。贾母一句胡说，轻轻带过。黛玉也不说破。二人从此相识，再未分开。",
  );
});

test("Reject leaves the text as it was; an accepted rewrite is what the file gets", async ({
  page,
}) => {
  await propose(page, "/notes/note.md");
  await changes(page)
    .getByRole("button", { name: "Reject", exact: true })
    .click();
  await expect(changes(page)).toHaveCount(0);
  await expect(page.locator(`${editor} p`)).toHaveText(NOTE);

  await ask(page);
  await acceptAll(page);
  await expect(page.locator(`${editor} p`)).toHaveText(REWRITE);
  await emit(page, "menu-save-file");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __devFiles: Record<string, string> })
            .__devFiles["/notes/note.md"],
      ),
    )
    .toBe(`# 笔记\n\n${REWRITE}\n`);
});

test("a rewrite whose settled call names less than its draft did lands without a crash", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await openApp(page, {
    animations: true,
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  const first = "第一段说起点。它有两句话。";
  const rest = Array.from(
    { length: 20 },
    (_, i) => `第 ${i} 段写了很多很多的内容。又一句话在这里。`,
  );
  await pasteMarkdown(page, `# 笔记\n\n${first}\n\n${rest.join("\n\n")}`);
  // Settled, the call names only the first paragraph, while the draft's
  // rewrite of them all is still typing in: laid out anew, not crashed.
  await page.evaluate((anchor) => {
    const w = window as unknown as {
      __devSettle: (blocks: unknown, name: string, json: string) => string;
      __devNameCall: (blocks: unknown, args: object) => object;
    };
    const settle = w.__devSettle;
    w.__devSettle = (blocks, name, json) => {
      const { text } = JSON.parse(settle(blocks, name, json));
      const args = w.__devNameCall(blocks, { action: "replace", anchor, text });
      return settle(blocks, name, JSON.stringify(args));
    };
  }, first);
  const rewrite = [first, ...rest.map((p) => p.replace("很多很多", "许多"))];
  await streamRevise(
    page,
    [
      {
        id: "s1",
        args: {
          action: "replace",
          anchor: [first, ...rest].join("\n\n"),
          text: rewrite.join("\n\n"),
        },
      },
    ],
    { chunk: 40, every: 10 },
  );
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Polish this");
  await composer.press("Enter");
  await expect(page.locator(".agent-panel-view")).toContainText("Tightened.");
  await expect(page.locator(".milkdown .pending-reading").first()).toBeHidden();
  expect(errors).toEqual([]);
});
