import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

// Inline code inside bold, italic and strikethrough: typed, made with
// Ctrl+B, pasted, and saved as written.

const editor = '[data-active-tab="true"] .ProseMirror';

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

test.beforeEach(async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await page.locator(editor).click();
});

test("code typed inside bold, italic and strikethrough is code", async ({
  page,
}) => {
  await page.keyboard.type("**bold `code` bold** *it `c`* ~~gone `x`~~ end");
  await expect(page.locator(`${editor} strong code`)).toHaveText("code");
  await expect(page.locator(`${editor} em code`)).toHaveText("c");
  await expect(page.locator(`${editor} del code`)).toHaveText("x");
  expect(await sourceOf(page)).toBe(
    "**bold `code` bold** *it `c`* ~~gone `x`~~ end",
  );
  // Read back from the source, it is the same.
  await expect(page.locator(`${editor} strong code`)).toHaveText("code");
});

test("Ctrl+B makes a selection with code in it bold", async ({ page }) => {
  await pasteMarkdown(page, "Run `npm test` first.");
  // From after "Run " to before "." - across the code.
  await page.evaluate(() => {
    type View = {
      state: {
        doc: unknown;
        tr: { setSelection(selection: unknown): unknown };
        selection: { constructor: { create(...args: unknown[]): unknown } };
      };
      dispatch(tr: unknown): void;
      focus(): void;
    };
    const view = (window as unknown as { __pmView: View }).__pmView;
    const { state } = view;
    const selection = state.selection.constructor.create(state.doc, 5, 21);
    view.dispatch(state.tr.setSelection(selection));
    view.focus();
  });
  await page.keyboard.press("Control+b");
  await expect(page.locator(`${editor} strong code`)).toHaveText("npm test");
  expect(await sourceOf(page)).toBe("Run **`npm test` first**.");
});

test("pasted bold around code stays bold around code", async ({ page }) => {
  await pasteMarkdown(page, "粗体 **加粗 `代码` 加粗** 完");
  await expect(page.locator(`${editor} strong code`)).toHaveText("代码");
  expect(await sourceOf(page)).toBe("粗体 **加粗 `代码` 加粗** 完");
});

test("a paste that starts with bold keeps it", async ({ page }) => {
  // The open bold at the start of the pasted text was poured into the
  // paragraph, and came in as plain text.
  await pasteMarkdown(page, "**bold `code` bold** after");
  await expect(page.locator(`${editor} strong code`)).toHaveText("code");
  await page.keyboard.press("Enter");
  await pasteMarkdown(page, "`code` and $x$");
  await expect(page.locator(`${editor} p`).nth(1).locator("code")).toHaveText(
    "code",
  );
  expect(await sourceOf(page)).toBe(
    "**bold `code` bold** after\n\n`code` and $x$",
  );
});

test("code inside bold is bold, with its own background", async ({ page }) => {
  await pasteMarkdown(page, "**bold `code` bold**");
  const styles = await page
    .locator(`${editor} strong code`)
    .evaluate((code) => {
      const own = getComputedStyle(code);
      const bold = getComputedStyle(code.parentElement!);
      return {
        weight: own.fontWeight,
        boldWeight: bold.fontWeight,
        background: own.backgroundColor,
        padding: own.paddingLeft,
      };
    });
  expect(styles.weight).toBe(styles.boldWeight);
  expect(styles.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(parseFloat(styles.padding)).toBeGreaterThan(0);
});
