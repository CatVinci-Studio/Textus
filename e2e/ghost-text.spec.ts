import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

// A paragraph for the AI edit to rewrite a sentence of.
const ORIGINAL =
  "The keeper woke before dawn. The lamp was still warm. Outside, the sea was calm.";

/**
 * The grey completion: it goes the moment what it continues changes -
 * typing that differs, an IME composition, a paste, an undo, a caret move,
 * a Textus AI edit - and a reply that comes back after the text moved on
 * is dropped. Typing its own next letters keeps the rest on offer. And it
 * isn't asked for where there's no prose to continue, such as right after
 * a diagram.
 */

const CANNED = " and this ghost text is a canned dev-shim suggestion.";

type Held = { args: { hints?: Record<string, unknown> }; release: () => void };

/** Keeps every ai_complete request waiting until the test releases it:
 *  `window.__completions`, in the order they were sent. */
async function holdCompletions(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      };
      __completions: Held[];
    };
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__completions = [];
    w.__TAURI_INTERNALS__.invoke = (cmd, args) =>
      cmd !== "ai_complete"
        ? original(cmd, args)
        : new Promise((resolve) => {
            w.__completions.push({
              args: args as Held["args"],
              release: () => resolve(original(cmd, args)),
            });
          });
  });
}

const sent = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __completions: Held[] }).__completions.length,
  );

const release = (page: Page, index: number) =>
  page.evaluate(
    (i) =>
      (window as unknown as { __completions: Held[] }).__completions[
        i
      ].release(),
    index,
  );

async function typeAfter(page: Page, text: string, typed: string) {
  await pasteMarkdown(page, text);
  await page.locator(".milkdown p", { hasText: text }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(typed);
}

test("typing the suggestion's next letters narrows it, other text ends it", async ({
  page,
}) => {
  await openApp(page);
  await typeAfter(page, "The plan", " works");
  const ghost = page.locator(".ghost-text");
  await expect(ghost).toHaveAttribute("data-suggestion", CANNED);
  await page.keyboard.type(" an");
  await expect(ghost).toHaveAttribute("data-suggestion", CANNED.slice(3));
  await page.keyboard.type("x");
  await expect(ghost).toHaveCount(0);
});

test("paste, undo and a caret move each end the suggestion", async ({
  page,
}) => {
  await openApp(page);
  const ghost = page.locator(".ghost-text");
  await typeAfter(page, "The plan", " works");
  await expect(ghost).toHaveCount(1);
  await pasteMarkdown(page, " again");
  await expect(ghost).toHaveCount(0);
  await expect(ghost).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(ghost).toHaveCount(0);
  await page.keyboard.type(" more");
  await expect(ghost).toHaveCount(1);
  await page.keyboard.press("ArrowLeft");
  await expect(ghost).toHaveCount(0);
});

test("an IME composition ends the suggestion, and a reply landing during it is dropped", async ({
  page,
}) => {
  await openApp(page);
  const ghost = page.locator(".ghost-text");
  await typeAfter(page, "The plan", " works");
  await expect(ghost).toHaveCount(1);
  // Chromium's own IME path, as fcitx/Rime and Pinyin drive it: a preedit,
  // then the committed text.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "ni",
    selectionStart: 2,
    selectionEnd: 2,
  });
  await expect(ghost).toHaveCount(0);
  await cdp.send("Input.insertText", { text: "你" });
  await expect(ghost).toHaveCount(0);
  // A request already out when the next composition starts.
  await holdCompletions(page);
  await page.keyboard.type(" ok");
  await expect.poll(() => sent(page)).toBe(1);
  await cdp.send("Input.imeSetComposition", {
    text: "hao",
    selectionStart: 3,
    selectionEnd: 3,
  });
  await release(page, 0);
  await page.waitForTimeout(200);
  await expect(ghost).toHaveCount(0);
  await cdp.send("Input.insertText", { text: "好" });
  await page.waitForTimeout(200);
  await expect(ghost).toHaveCount(0);
  await expect(page.locator(".milkdown p").first()).toHaveText(
    "The plan works你 ok好",
  );
});

test("IME input ends the suggestion before anything reaches the document", async ({
  page,
}) => {
  // An IME showing its preedit in its own window (fcitx5 can) changes the
  // document only at the commit; the page sees its keys (keyCode 229) and,
  // with some, a compositionstart.
  await openApp(page);
  const ghost = page.locator(".ghost-text");
  const root = '[data-active-tab="true"] .ProseMirror';
  await typeAfter(page, "The plan", " works");
  await expect(ghost).toHaveCount(1);
  await page.locator(root).evaluate((el) => {
    const key = new KeyboardEvent("keydown", { key: "n", bubbles: true });
    Object.defineProperty(key, "keyCode", { value: 229 });
    el.dispatchEvent(key);
  });
  await expect(ghost).toHaveCount(0);
  await page.keyboard.type(" again");
  await expect(ghost).toHaveCount(1);
  await page.locator(root).evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
  });
  await expect(ghost).toHaveCount(0);
});

test("a reply for text that has changed since is dropped, even with the caret where it was", async ({
  page,
}) => {
  await openApp(page);
  await holdCompletions(page);
  const ghost = page.locator(".ghost-text");
  await typeAfter(page, "The plan", " works");
  await expect.poll(() => sent(page)).toBe(1);
  // One letter typed over another: the caret ends up where it was.
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.type("e");
  await release(page, 0);
  await page.waitForTimeout(200);
  await expect(ghost).toHaveCount(0);
  // The request for the text as it is now still shows.
  await expect.poll(() => sent(page)).toBe(2);
  await release(page, 1);
  await expect(ghost).toHaveCount(1);
});

test("a reply landing while a Textus AI edit is on show is dropped", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "inline" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await holdCompletions(page);
  await pasteMarkdown(page, ORIGINAL);
  await page.keyboard.press("Enter");
  await page.keyboard.type("The plan works");
  await expect.poll(() => sent(page)).toBe(1);
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "go" },
      {
        kind: "ToolCall",
        call_id: "r1",
        name: "propose_edit",
        // As long as the original, so the caret below keeps its place.
        arguments: JSON.stringify({
          action: "replace",
          anchor: "The lamp was still warm.",
          text: "The lamp was quite warm.",
        }),
      },
      { kind: "ToolResult", call_id: "r1", output: "Edit proposed" },
      { kind: "Assistant", text: "Done." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Tighten it");
  await composer.press("Enter");
  await expect(page.locator(".milkdown .pending-pick")).not.toHaveCount(0);
  await release(page, 0);
  await page.waitForTimeout(200);
  await expect(page.locator(".ghost-text")).toHaveCount(0);
});

test("no completion is asked for right after a diagram with no prose, and the app's language goes along", async ({
  page,
}) => {
  // The Chinese UI (openApp's default), as in the report.
  await openApp(page);
  await mockInvoke(page, { ai_complete: "继续写" });
  const calls = () =>
    page.evaluate(() =>
      (
        (window as unknown as { __devInvokeCalls?: { cmd: string }[] })
          .__devInvokeCalls ?? []
      ).filter((c) => c.cmd === "ai_complete"),
    );
  await pasteMarkdown(page, "```mermaid\ngraph TD\n  A-->B\n```\n\nx");
  await page.locator(".milkdown p", { hasText: "x" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(1200);
  expect(await calls()).toEqual([]);
  await expect(page.locator(".ghost-text")).toHaveCount(0);
  await page.keyboard.type("图");
  await expect.poll(async () => (await calls()).length).toBe(1);
  const [call] = (await calls()) as unknown as {
    before: string;
    hints: { prose: string; uiLanguage: string };
  }[];
  expect(call.before).toContain("graph TD");
  expect(call.hints.prose).toBe("图");
  expect(call.hints.uiLanguage).toBe("zh");
});

test("typing in a code block asks for no completion", async ({ page }) => {
  await openApp(page);
  await mockInvoke(page, { ai_complete: "x = 1" });
  await pasteMarkdown(page, "```js\nconst total = count\n```\n\n后面");
  await page.locator(".milkdown pre code").click();
  await page.keyboard.press("End");
  await page.keyboard.type("er");
  await page.waitForTimeout(1200);
  expect(await completeCalls(page)).toHaveLength(0);
  await expect(page.locator(".ghost-text")).toHaveCount(0);
});

const completeCalls = (page: Page) =>
  page.evaluate(() =>
    (
      (window as unknown as { __devInvokeCalls?: { cmd: string }[] })
        .__devInvokeCalls ?? []
    ).filter((c) => c.cmd === "ai_complete"),
  ) as Promise<unknown[]>;

test("mid-document, at a paragraph's end, a completion leads into what follows", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await mockInvoke(page, { ai_complete: " out before dawn." });
  await pasteMarkdown(page, "The tide went\n\nThe boats came back at dusk.");
  await page.locator(".milkdown p", { hasText: "The tide went" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" ");
  await expect(page.locator(".ghost-text")).toHaveCount(1);
  const [call] = (await completeCalls(page)) as { after: string }[];
  expect(call.after).toContain("The boats came back at dusk.");
});

test("a pause asks once it has lasted, and an empty new paragraph asks nothing", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await mockInvoke(page, { ai_complete: " out before dawn." });
  await pasteMarkdown(page, "The tide went");
  await page.locator(".milkdown p", { hasText: "The tide went" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" o");
  // Still a breath between words.
  await page.waitForTimeout(400);
  expect(await completeCalls(page)).toHaveLength(0);
  await expect.poll(async () => (await completeCalls(page)).length).toBe(1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  expect(await completeCalls(page)).toHaveLength(1);
  await expect(page.locator(".ghost-text")).toHaveCount(0);
});

test("right after a full stop or a comma nothing is asked for; after a word it is", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await mockInvoke(page, { ai_complete: " the boats came in." });
  await pasteMarkdown(page, "The tide went out");
  await page.locator(".milkdown p", { hasText: "The tide went out" }).click();
  await page.keyboard.press("End");
  for (const mark of [". ", ","]) {
    await page.keyboard.type(mark);
    await page.waitForTimeout(1200);
    expect(await completeCalls(page)).toHaveLength(0);
  }
  await page.keyboard.type(" and");
  await expect.poll(async () => (await completeCalls(page)).length).toBe(1);
});
