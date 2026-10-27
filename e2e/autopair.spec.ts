import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

function emit(page: Page, name: string) {
  return page.evaluate(
    (n) =>
      (
        window as unknown as { __devEmitTauriEvent: (name: string) => void }
      ).__devEmitTauriEvent(n),
    name,
  );
}

/** The active document's Markdown, read from source mode (and back). */
async function sourceOf(page: Page): Promise<string> {
  await emit(page, "menu-toggle-source-mode");
  const textarea = page.locator(
    '[data-active-tab="true"] textarea.source-view',
  );
  await expect(textarea).toBeAttached();
  const value = await textarea.inputValue();
  await emit(page, "menu-toggle-source-mode");
  await expect(textarea).toHaveCount(0);
  return value.trim();
}

const editorOf = (page: Page) =>
  page.locator('[data-active-tab="true"] .ProseMirror');

/** The text of the caret's paragraph with "|" at the caret. */
function caretLine(page: Page): Promise<string> {
  return page.evaluate(() => {
    const sel = document.getSelection()!;
    const block = sel.anchorNode!.parentElement!.closest("p, td, th")!;
    const range = document.createRange();
    range.setStart(block, 0);
    range.setEnd(sel.anchorNode!, sel.anchorOffset);
    const before = range.toString();
    return before + "|" + block.textContent!.slice(before.length);
  });
}

test("brackets and quotes close themselves, and the typed closer steps over", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await editorOf(page).click();
  await page.keyboard.type("(", { delay: 30 });
  expect(await caretLine(page)).toBe("(|)");
  await page.keyboard.type('x) [a] {b} "q" don\'t （【c】）', { delay: 30 });
  expect(await caretLine(page)).toBe('(x) [a] {b} "q" don\'t （【c】）|');
  // Backspace right after an opener takes its partner too.
  await page.keyboard.type(" 「", { delay: 30 });
  await page.keyboard.press("Backspace");
  expect(await caretLine(page)).toBe('(x) [a] {b} "q" don\'t （【c】） |');
  expect(await sourceOf(page)).toBe('(x) \\[a] {b} "q" don\'t （【c】）');
});

test("an opener typed over a selection wraps it", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await editorOf(page).click();
  await page.keyboard.type("see word", { delay: 30 });
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.type("《");
  expect(await sourceOf(page)).toBe("see 《word》");
});

test("a typed [text](url) still becomes a link", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await editorOf(page).click();
  await page.keyboard.type("[Textus](https://textus.catvinci.com) on", {
    delay: 30,
  });
  await expect(editorOf(page).locator("a")).toHaveText("Textus");
  expect(await sourceOf(page)).toBe("[Textus](https://textus.catvinci.com) on");
});

// The ")" is already there: the address typed, the caret moves on - an
// arrow, End, Home, Enter - without typing it.
for (const leave of ["ArrowRight", "End", "Enter", "Home"])
  test(`[text](url with its ")" put in becomes a link on ${leave}`, async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    await editorOf(page).click();
    await page.keyboard.type("See [Textus](https://textus.catvinci.com", {
      delay: 30,
    });
    await page.keyboard.press(leave);
    await expect(editorOf(page).locator("a")).toHaveText("Textus");
    expect(await sourceOf(page)).toBe(
      "See [Textus](https://textus.catvinci.com)",
    );
  });

test("brackets committed by an input method close themselves too", async ({
  page,
  browserName,
}) => {
  // Compositions are sent over the Chrome DevTools Protocol; the unit
  // tests play WebKitGTK's deleteCompositionText + insertFromComposition.
  test.skip(browserName !== "chromium");
  await openApp(page, { settings: { language: "en" } });
  const editor = editorOf(page);
  await editor.click();
  const cdp = await page.context().newCDPSession(page);
  const compose = async (preedit: string, committed: string) => {
    await cdp.send("Input.imeSetComposition", {
      text: preedit,
      selectionStart: preedit.length,
      selectionEnd: preedit.length,
    });
    await cdp.send("Input.insertText", { text: committed });
    // Past the post-commit pairing (40ms) before the next composition.
    await page.waitForTimeout(100);
  };
  await compose("（", "（");
  expect(await caretLine(page)).toBe("（|）");
  await compose("nihao", "你好");
  expect(await caretLine(page)).toBe("（你好|）");
  await compose("）", "）");
  expect(await caretLine(page)).toBe("（你好）|");
  await compose("shu<", "书《");
  await compose("ming", "名");
  await compose("》", "》");
  expect(await sourceOf(page)).toBe("（你好）书《名》");
});

test("with the setting off, brackets stay as typed", async ({ page }) => {
  await openApp(page, {
    settings: { language: "en", autoCloseBrackets: false },
  });
  await editorOf(page).click();
  await page.keyboard.type('("[{（', { delay: 30 });
  expect(await caretLine(page)).toBe('("[{（|');
});

test("the setting is in Editor & Appearance, on by default", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await emit(page, "menu-open-settings");
  const panel = page.getByRole("dialog", { name: "Settings" });
  await panel.getByRole("button", { name: "Editor & Appearance" }).click();
  const toggle = panel.getByRole("checkbox", {
    name: "Close (), [] and “”",
  });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("catvinci-settings") ?? "{}")
            .autoCloseBrackets,
      ),
    )
    .toBe(false);
});

test("_italic_ becomes italic, saved with underscores; snake_case stays", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  const editor = editorOf(page);
  await editor.click();
  await page.keyboard.type("an _italic_ word and snake_case", { delay: 30 });
  await expect(editor.locator("em")).toHaveText("italic");
  expect(await sourceOf(page)).toBe("an _italic_ word and snake_case");
});

test("Tab in a table moves to the end of the next cell, and Shift+Enter breaks the line in a cell", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  const editor = editorOf(page);
  await editor.click();
  await pasteMarkdown(page, "| a | b |\n| --- | --- |\n| one | two |\n");
  await editor.locator("td p").first().click();
  await page.waitForTimeout(200);
  expect(await caretLine(page)).toMatch(/^o?n?e?\|/);
  await page.keyboard.press("Tab");
  expect(await caretLine(page)).toBe("two|");
  await page.keyboard.type("!", { delay: 30 });
  await page.keyboard.press("Shift+Tab");
  expect(await caretLine(page)).toBe("one|");
  // Shift held first: pressed together with Enter it counts as an Enter.
  await page.keyboard.down("Shift");
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await page.keyboard.up("Shift");
  await page.keyboard.type("more", { delay: 30 });
  await expect(editor.locator("td").first().locator("br")).toHaveCount(1);
  expect(await sourceOf(page)).toMatch(/\| one<br>more \| two! +\|/);
  // Read back from the file: still a line break in the cell.
  await expect(editor.locator("td").first().locator("br")).toHaveCount(1);
  await expect(editor.locator("td").first()).toHaveText("onemore");
});
