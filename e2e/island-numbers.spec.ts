import { expect, test } from "@playwright/test";
import { emit, openApp, pasteMarkdown } from "./helpers";

// Ctrl (⌘ on a Mac) held alone shows a number on each island; with them
// up, Ctrl+1–6 goes to that island instead of making a heading.

test("Ctrl held shows the islands' numbers and a number goes to that island; without the hold it is a heading", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
  await pasteMarkdown(page, "第一篇");
  await emit(page, "menu-split-right");
  const editors = page.locator(".ProseMirror:visible");
  await expect(editors).toHaveCount(2);
  const active = page.locator('[data-active-tab="true"]');
  await editors.first().click();
  await expect(active).toHaveAttribute("data-pane", "first");

  const numbers = page.locator(".island-number");
  await page.keyboard.down("Control");
  await expect(numbers).toHaveCount(0);
  await page.waitForTimeout(600);
  await expect(numbers).toHaveText(["1", "2"]);
  // Each on its own island.
  const sheet = (await page.locator("section.island").last().boundingBox())!;
  const second = (await numbers.last().boundingBox())!;
  expect(second.x).toBeGreaterThan(sheet.x);
  expect(second.x).toBeLessThan(sheet.x + sheet.width);

  await page.keyboard.press("2");
  await expect(active).toHaveAttribute("data-pane", "second");
  await expect(editors.last()).toBeFocused();
  await page.keyboard.up("Control");
  await expect(numbers).toHaveCount(0);
  await expect(page.locator(".ProseMirror h2")).toHaveCount(0);
  // Back to the first, which has words and so its corner's readout: the
  // focus still goes into its text.
  await page.keyboard.down("Control");
  await page.waitForTimeout(600);
  await page.keyboard.press("1");
  await page.keyboard.up("Control");
  await expect(editors.first()).toBeFocused();
  await page.keyboard.down("Control");
  await page.waitForTimeout(600);
  await page.keyboard.press("2");
  await page.keyboard.up("Control");
  await expect(editors.last()).toBeFocused();

  // What is typed next lands there; pressed at once, Ctrl+2 is a heading.
  await page.keyboard.type("第二篇");
  await page.keyboard.press("Control+2");
  await expect(editors.last().locator("h2")).toContainText("第二篇");
  await expect(editors.first().locator("h2")).toHaveCount(0);
  await expect(numbers).toHaveCount(0);
});
