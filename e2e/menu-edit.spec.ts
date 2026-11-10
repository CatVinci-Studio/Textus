import { expect, test, type Page } from "@playwright/test";
import { emit, openApp } from "./helpers";

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
