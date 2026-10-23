import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

// Written text comes in a word at a time (ui/cascade.ts), as a reply
// streams in Claude's apps: the AI's text landing in the document, a
// diagram's parts one after another, its nodes first. A block of words
// used to fade in at once, and a diagram whole.

const editor = '[data-active-tab="true"] .ProseMirror';

async function open(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, {
    settings: { language: "en", diagramEngine: "mermaid" },
    storage: { "textus-agent-panel-open": "1" },
    animations: true,
  });
  await pasteMarkdown(page, "The first paragraph.");
}

async function propose(page: Page, text: string) {
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "go" },
      {
        kind: "ToolCall",
        call_id: "c1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "insert_after",
          anchor: "The first paragraph.",
          text,
        }),
      },
      { kind: "ToolResult", call_id: "c1", output: "Edit proposed" },
      { kind: "Assistant", text: "Done." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Go on");
  await composer.press("Enter");
}

/** When each element's own animation starts, in ms after now (its delay
 *  less the time it has run), in order. */
function starts(page: Page, selector: string) {
  return page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)].map((el) => {
      const a = el.getAnimations()[0];
      if (!a) return null;
      const t = a.effect?.getComputedTiming();
      return (Number(t?.delay ?? 0) - Number(a.currentTime ?? 0)) | 0;
    });
  }, selector);
}

test("the words of what lands come in one after another, not at once", async ({
  page,
}) => {
  await open(page);
  await propose(
    page,
    "The keeper climbed the stairs one at a time, counting each of them aloud.",
  );
  const words = `${editor} .pending-insert .cascade-word`;
  await expect(page.locator(words).first()).toBeAttached();
  const at = (await starts(page, words)).filter((s): s is number => s !== null);
  expect(at.length).toBeGreaterThan(8);
  // Each later than the one before, and the run within the budget.
  for (let i = 1; i < at.length; i++)
    expect(at[i]).toBeGreaterThanOrEqual(at[i - 1]);
  expect(at.at(-1)! - at[0]).toBeGreaterThan(50);
  expect(at.at(-1)! - at[0]).toBeLessThanOrEqual(750);
  // And then it is plain text again, all there.
  await expect(page.locator(`${editor} .pending-insert`)).toContainText(
    "counting each of them aloud.",
  );
});

test("a diagram is built up a part at a time, its nodes first", async ({
  page,
}) => {
  await open(page);
  await propose(
    page,
    "```mermaid\nflowchart LR\n  A[Start] --> B[Middle]\n  B --> C[End]\n```",
  );
  const parts = `${editor} .pending-diagram svg .diagram-part-enter`;
  await expect(page.locator(parts).first()).toBeAttached({ timeout: 10_000 });
  const delays = await page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)].map((el) => ({
      node: el.classList.contains("node"),
      delay: parseFloat((el as SVGElement).style.animationDelay) || 0,
    }));
  }, parts);
  expect(delays.length).toBeGreaterThan(3);
  const nodes = delays.filter((d) => d.node).map((d) => d.delay);
  const rest = delays.filter((d) => !d.node).map((d) => d.delay);
  expect(nodes.length).toBe(3);
  // Not all at once, and every node before what joins them.
  expect(new Set(delays.map((d) => d.delay)).size).toBeGreaterThan(3);
  expect(Math.max(...nodes)).toBeLessThan(Math.min(...rest));
});

test("a reply streaming into the chat comes in a word at a time, its words still coming in carrying on", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      };
    };
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd !== "ai_agent_message") return original(cmd, args);
      const { message, onEvent } = args as {
        message: string;
        onEvent?: { onmessage?: (e: unknown) => void };
      };
      const text =
        "The opening reads well, and the second sentence carries the scene; the third could be shorter.";
      const pieces = text.split(/(?<=\s)/);
      return new Promise((resolve) => {
        let i = 0;
        const tick = () => {
          if (i < pieces.length) {
            onEvent?.onmessage?.({ type: "delta", text: pieces[i++] });
            setTimeout(tick, 60);
          } else {
            const reply = { kind: "Assistant", text };
            onEvent?.onmessage?.({ type: "turn", turn: reply });
            resolve([{ kind: "User", text: message }, reply]);
          }
        };
        setTimeout(tick, 60);
      });
    };
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("How does it read?");
  await composer.press("Enter");
  const words = ".agent-streaming .cascade-word";
  await expect(page.locator(words).first()).toBeAttached();
  // Mid-stream: the newest words still fading in.
  const fading = await page.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)].filter(
        (el) => Number(getComputedStyle(el).opacity) < 1,
      ).length,
    words,
  );
  expect(fading).toBeGreaterThan(0);
  await expect(page.locator(".agent-message-assistant").last()).toContainText(
    "the third could be shorter.",
  );
  // Shown again from the conversation, a reply is simply there.
  await expect(
    page.locator(
      ".agent-message-assistant:not(.agent-streaming *) .cascade-word",
    ),
  ).toHaveCount(0);
});
