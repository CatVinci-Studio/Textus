import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * Selecting by dragging past the bottom or top of the document scrolls it
 * and takes the selection along (#219): WebKitGTK, the Linux app's web
 * view, did neither downwards and crawled upwards.
 */

const scroller = '[data-active-tab="true"] .editor-scroll';

test("dragging a selection past the bottom scrolls down and selects on", async ({
  page,
}) => {
  await openApp(page);
  const lines = Array.from(
    { length: 120 },
    (_, i) => `Paragraph ${i + 1} of a long document.`,
  );
  await pasteMarkdown(page, lines.join("\n\n"));
  await page.locator(scroller).evaluate((el) => (el.scrollTop = 0));
  const box = (await page.locator(scroller).boundingBox())!;
  const start = page.locator(".ProseMirror p").nth(3);
  const at = (await start.boundingBox())!;
  await page.mouse.move(at.x + 5, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + 40, box.y + box.height - 2, { steps: 4 });
  await page.mouse.move(at.x + 40, box.y + box.height + 30, { steps: 4 });
  await page.waitForTimeout(1200);
  const scrolled = await page.locator(scroller).evaluate((el) => el.scrollTop);
  await page.mouse.up();
  expect(scrolled).toBeGreaterThan(300);
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  expect(selected).toContain("Paragraph 18 of");
});
