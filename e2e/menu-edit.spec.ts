import { expect, test, type Page } from "@playwright/test";
import { MAC, emit, openApp, pasteMarkdown } from "./helpers";

// On a Mac, ⌘Z, ⇧⌘Z and ⌘A reach the app as the native Edit menu's events
// (menu.rs MAC_EDIT_ITEMS): these send those same events, so the islands
// route them to the document in use - the second island's too.

const docs = (page: Page) => page.locator(".ProseMirror:visible");
const text = (page: Page, i: number) =>
  docs(page)
    .nth(i)
    .evaluate((e) => (e as HTMLElement).innerText.trim());

test("the Edit menu's Undo, Redo and Select All act on the document in use", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
  await docs(page).first().click();
  await page.keyboard.type("alpha");
  await expect.poll(() => text(page, 0)).toBe("alpha");
  await emit(page, "menu-undo");
  await expect.poll(() => text(page, 0)).toBe("");
  await emit(page, "menu-redo");
  await expect.poll(() => text(page, 0)).toBe("alpha");

  // Split: the second island's document is the one in use.
  await emit(page, "menu-split-right");
  await expect(docs(page)).toHaveCount(2);
  await docs(page).nth(1).click();
  await page.keyboard.type("beta");
  await emit(page, "menu-select-all");
  await expect
    .poll(() => page.evaluate(() => String(getSelection())))
    .toBe("beta");
  await emit(page, "menu-undo");
  await expect.poll(() => text(page, 1)).toBe("");
  // The first island's document kept its own.
  expect(await text(page, 0)).toBe("alpha");
});

test("Find and Replace work in source mode, on the source in use", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
  await docs(page).first().click();
  await page.keyboard.type("cat dog cat");
  await emit(page, "menu-toggle-source-mode");
  const source = page.locator(".source-view .cm-content");
  await expect(source).toContainText("cat dog cat");
  await source.click();
  await emit(page, "menu-find-replace");
  const bar = page.locator(".find-replace-bar");
  await expect(bar).toBeVisible();
  await bar.getByRole("textbox").first().fill("cat");
  await expect(page.locator(".source-view .find-match")).toHaveCount(2);
  await emit(page, "menu-replace");
  await bar.getByRole("textbox").nth(1).fill("cow");
  await bar.getByRole("button", { name: /全部替换|Replace All/ }).click();
  await expect(source).toContainText("cow dog cow");
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
});

test("in source mode the format keys and the Format menu write Markdown", async ({
  page,
}) => {
  await openApp(page, { settings: { menuBarShown: false } });
  await docs(page).first().click();
  await page.keyboard.type("word");
  await emit(page, "menu-toggle-source-mode");
  const source = page.locator(".source-view .cm-content");
  await expect(source).toContainText("word");
  await source.click();
  await page.keyboard.press(MAC ? "Meta+a" : "Control+a");
  await page.keyboard.press(MAC ? "Meta+b" : "Control+b");
  await expect(source).toHaveText("**word**");
  await emit(page, "menu-insert-block", "h2");
  await expect(source).toHaveText("## **word**");
  await page.keyboard.press(MAC ? "Meta+a" : "Control+a");
  await emit(page, "menu-toggle-mark", "highlight");
  await expect(source).toHaveText("==## **word**==");
});

test("a ⌘ or Ctrl click in the text places the caret, never selects the block", async ({
  page,
}) => {
  await openApp(page);
  await pasteMarkdown(page, "> **W1:** quoted words here\n\nafter\n");
  const quoted = docs(page).first().locator("blockquote p");
  await quoted.click({ modifiers: [MAC ? "Meta" : "Control"] });
  await page.waitForTimeout(100);
  await expect(page.locator(".ProseMirror-selectednode")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => !!getSelection()?.anchorNode?.parentElement?.closest("blockquote"),
    ),
  ).toBe(true);
});
