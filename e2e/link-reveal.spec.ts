import { expect, test, type Page } from "@playwright/test";
import { END, HOME, mockInvoke, openApp, selectionRead } from "./helpers";

// A link the caret is on shows as its Markdown, edited in place; leave it and
// it is a link again, as edited. Ctrl/Cmd+click still opens it. The file is
// opened the way a dropped file is.

const editor = '[data-active-tab="true"] .ProseMirror';
const source = `${editor} .link-source`;

/** Each kind of link: its text as shown, and its Markdown. */
const KINDS = [
  ["a link", "resource", "[resource](https://a.org/r)"],
  ["a link with a title", "titled", '[titled](https://a.org/t "The title")'],
  ["a reference link", "reference", "[reference][ref]"],
  ["an autolink", "https://a.org/auto", "<https://a.org/auto>"],
  ["a bare URL", "https://a.org/bare", "https://a.org/bare"],
] as const;

const DOC = [
  "Start here.",
  ...KINDS.map(([, , markdown]) => `A ${markdown} link.`),
  "[ref]: https://a.org/ref",
].join("\n\n");

/** What follows each link on its line. */
const AFTER = " link.";

async function openDoc(page: Page) {
  await openApp(page, { settings: { language: "en" } });
  await mockInvoke(page, { read_text_file: `${DOC}\n`, file_mtime_ms: 1 });
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string, payload: unknown) => void;
      }
    ).__devEmitTauriEvent("tauri://drag-drop", {
      paths: ["/home/me/links.md"],
      position: { x: 0, y: 0 },
    }),
  );
  await expect(page.locator(`${editor} a`)).toHaveCount(KINDS.length);
}

/** Presses `key` `times` times, each once the selection before it is read:
 *  pressed back to back, WebKit loses some arrow presses. */
async function press(page: Page, key: string, times = 1) {
  for (let i = 0; i < times; i++) {
    await selectionRead(page);
    await page.keyboard.press(key);
    await selectionRead(page);
  }
}

/** The paragraph a link of `label` stands in. */
const line = (page: Page, label: string) =>
  page.locator(`${editor} p`, { hasText: label }).first();

/** Clicks just right of the middle of character `index` of the link
 *  `label`, which puts the caret after that character. */
async function clickAfterChar(page: Page, label: string, index: number) {
  const box = await page
    .locator(`${editor} a`, { hasText: label })
    .evaluate((a, i) => {
      const range = document.createRange();
      const text = a.firstChild!;
      range.setStart(text, i);
      range.setEnd(text, i + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.right - 1, y: rect.top + rect.height / 2 };
    }, index);
  await page.mouse.click(box.x, box.y);
}

/** The caret at the start of the paragraph holding `label`. */
async function caretAtLineStart(page: Page, label: string) {
  await line(page, label).click({ position: { x: 2, y: 8 } });
  await press(page, HOME);
}

async function leave(page: Page) {
  await page.locator(`${editor} p`, { hasText: "Start here." }).click();
  await expect(page.locator(source)).toHaveCount(0);
}

/** The active document's Markdown, read from source mode (and back). */
async function sourceOf(page: Page): Promise<string> {
  const emit = (name: string) =>
    page.evaluate(
      (n) =>
        (
          window as unknown as { __devEmitTauriEvent: (name: string) => void }
        ).__devEmitTauriEvent(n),
      name,
    );
  await emit("menu-toggle-source-mode");
  const textarea = page.locator(
    '[data-active-tab="true"] textarea.source-view',
  );
  await expect(textarea).toBeAttached();
  const value = await textarea.inputValue();
  await emit("menu-toggle-source-mode");
  await expect(textarea).toHaveCount(0);
  return value;
}

test.beforeEach(async ({ page }) => {
  await openDoc(page);
});

for (const [kind, label, markdown] of KINDS) {
  test(`a click on ${kind} shows its Markdown, and leaving shows the link`, async ({
    page,
  }) => {
    await page.locator(`${editor} a`, { hasText: label }).click();
    await expect(page.locator(source)).toHaveText(markdown);
    await expect(line(page, markdown)).toHaveText(`A ${markdown}${AFTER}`);
    await leave(page);
    await expect(page.locator(`${editor} a`, { hasText: label })).toHaveCount(
      1,
    );
  });

  test(`the arrow keys onto ${kind} show it, and off it show the link`, async ({
    page,
  }) => {
    await caretAtLineStart(page, label);
    await press(page, "ArrowRight");
    await expect(page.locator(source)).toHaveCount(0);
    // "A " - the caret at the link's start.
    await press(page, "ArrowRight");
    await expect(page.locator(source)).toHaveText(markdown);
    await press(page, "ArrowLeft");
    await expect(page.locator(source)).toHaveCount(0);
    // From the other side: past " link." to the link's end.
    await press(page, END);
    await press(page, "ArrowLeft", AFTER.length);
    await expect(page.locator(source)).toHaveText(markdown);
    await press(page, "ArrowRight");
    await expect(page.locator(source)).toHaveCount(0);
  });
}

test("the caret lands on the character that was clicked", async ({ page }) => {
  await clickAfterChar(page, "resource", 2);
  await page.keyboard.type("Z");
  await expect(page.locator(source)).toHaveText("[resZource](https://a.org/r)");
});

/** How far the drawn caret is from the right edge of character `index`
 *  of the shown source (-1: its left edge). WebKit can keep the right
 *  position and still paint the caret at the line's start. */
function caretOffBy(page: Page, index: number) {
  return page.locator(source).evaluate((el, i) => {
    // The source's text, split by the quiet syntax's spans.
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let at = Math.max(0, i);
    let text = walker.nextNode() as Text;
    while (at >= text.length) {
      at -= text.length;
      text = walker.nextNode() as Text;
    }
    const char = document.createRange();
    char.setStart(text, at);
    char.setEnd(text, at + 1);
    const box = char.getBoundingClientRect();
    const caret = window.getSelection()!.getRangeAt(0).getClientRects()[0];
    const x = i < 0 ? box.left : box.right;
    return caret ? Math.abs(caret.left - x) : Infinity;
  }, index);
}

test("the caret is drawn where it is in a link's source", async ({ page }) => {
  await clickAfterChar(page, "resource", 2);
  await expect(page.locator(source)).toHaveCount(1);
  // After "[res".
  expect(await caretOffBy(page, 3)).toBeLessThan(3);
  await press(page, "ArrowRight");
  expect(await caretOffBy(page, 4)).toBeLessThan(3);
  // At the link's start, outside its "[".
  await caretAtLineStart(page, "resource");
  await press(page, "ArrowRight");
  await press(page, "ArrowRight");
  await expect(page.locator(source)).toHaveCount(1);
  expect(await caretOffBy(page, -1)).toBeLessThan(3);
});

test("the URL and the text are edited in place, and saved as typed", async ({
  page,
}) => {
  await page.locator(`${editor} a`, { hasText: "resource" }).click();
  await press(page, END);
  // Before the link's closing parenthesis.
  await press(page, "ArrowLeft", AFTER.length + 1);
  await page.keyboard.type("/x");
  await press(page, HOME);
  await press(page, "ArrowRight", 3);
  await page.keyboard.type("New ");
  await expect(page.locator(source)).toHaveText(
    "[New resource](https://a.org/r/x)",
  );
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(source)).toHaveCount(0);
  await expect(
    page.locator(`${editor} a[href="https://a.org/r/x"]`),
  ).toHaveText("New resource");
  expect(await sourceOf(page)).toBe(
    `${DOC.replace("[resource](https://a.org/r)", "[New resource](https://a.org/r/x)")}\n`,
  );
});

test("a link that is no longer one is plain text", async ({ page }) => {
  await caretAtLineStart(page, "resource");
  await press(page, "ArrowRight");
  await press(page, "ArrowRight");
  await press(page, "ArrowRight");
  // The opening bracket.
  await page.keyboard.press("Backspace");
  await leave(page);
  // Text, with the URL in it a bare link of its own.
  await expect(line(page, "resource")).toHaveText(
    "A resource](https://a.org/r) link.",
  );
  await expect(
    page.locator(`${editor} a`, { hasText: "resource" }),
  ).toHaveCount(0);
});

test("looking at links leaves the document unchanged", async ({ page }) => {
  for (const [, label] of KINDS)
    await page.locator(`${editor} a`, { hasText: label }).click();
  await leave(page);
  await page.waitForTimeout(500);
  await expect(page.locator(".tab-pill-dirty-dot")).toHaveCount(0);
  expect(await sourceOf(page)).toBe(`${DOC}\n`);
});

test("one undo takes back an edited URL, and a redo puts it back", async ({
  page,
}) => {
  await page.locator(`${editor} a`, { hasText: "resource" }).click();
  await press(page, END);
  await press(page, "ArrowLeft", AFTER.length + 1);
  await page.keyboard.type("/x");
  await leave(page);
  await expect(
    page.locator(`${editor} a[href="https://a.org/r/x"]`),
  ).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(
    page.locator(`${editor} a[href="https://a.org/r/x"]`),
  ).toHaveCount(0);
  await expect(line(page, "resource")).toHaveText(
    "A [resource](https://a.org/r) link.",
  );
  // Elsewhere, the redo is still there.
  await page.locator(`${editor} p`, { hasText: "Start here." }).click();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(
    page.locator(`${editor} a[href="https://a.org/r/x"]`),
  ).toHaveCount(1);
});

test("Ctrl/Cmd+click opens a link shown as its Markdown", async ({ page }) => {
  await page.locator(`${editor} a`, { hasText: "resource" }).click();
  await expect(page.locator(source)).toHaveText("[resource](https://a.org/r)");
  await page.locator(source).click({ modifiers: ["ControlOrMeta"] });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __devLinks?: unknown[] }).__devLinks ?? [],
      ),
    )
    .toEqual([{ cmd: "open_web_link", url: "https://a.org/r" }]);
  await expect(page.locator(source)).toHaveCount(1);
});

test("Chinese typed with an input method goes into the link's text", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "composition is sent over CDP");
  await clickAfterChar(page, "resource", 2);
  await expect(page.locator(source)).toHaveCount(1);
  const cdp = await page.context().newCDPSession(page);
  for (const [preedit, committed] of [
    ["zhong", "中"],
    ["wen", "文"],
  ]) {
    await cdp.send("Input.imeSetComposition", {
      text: preedit,
      selectionStart: preedit.length,
      selectionEnd: preedit.length,
    });
    await cdp.send("Input.insertText", { text: committed });
    await page.waitForTimeout(100);
  }
  await cdp.detach();
  await expect(page.locator(source)).toHaveText(
    "[res中文ource](https://a.org/r)",
  );
  await leave(page);
  await expect(page.locator(`${editor} a[href="https://a.org/r"]`)).toHaveText(
    "res中文ource",
  );
});
