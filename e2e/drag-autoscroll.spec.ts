import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * Dragging a selection past the document's bottom or top scrolls it and
 * takes the selection along; WebKitGTK did neither downwards and crawled
 * upwards. A drag selects from wherever it begins: in the page's margin,
 * which only placed the caret, or on bold text or a heading, whose `**` or
 * `#` showing up under the pointer made the web view start over.
 */

const scroller = '[data-active-tab="true"] .editor-scroll';
const paragraphs = '[data-active-tab="true"] .ProseMirror p';

const selected = (page: Page) =>
  page.evaluate(() => window.getSelection()?.toString() ?? "");

for (const from of ["text", "margin"])
  test(`dragging a selection from the ${from} past the bottom scrolls down and selects on`, async ({
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
    const at = (await page.locator(paragraphs).nth(3).boundingBox())!;
    const x = from === "text" ? at.x + 5 : box.x + 12;
    await page.mouse.move(x, at.y + at.height / 2);
    await page.mouse.down();
    await page.mouse.move(at.x + 40, box.y + box.height - 2, { steps: 4 });
    await page.mouse.move(at.x + 40, box.y + box.height + 30, { steps: 4 });
    await page.waitForTimeout(1200);
    const scrolled = await page
      .locator(scroller)
      .evaluate((el) => el.scrollTop);
    await page.mouse.up();
    expect(scrolled).toBeGreaterThan(300);
    expect(await selected(page)).toContain("Paragraph 18 of");
  });

test("a drag from the page's margin selects the lines it passes", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "First line.\n\nSecond line.\n\nThird line.");
  const first = (await page.locator(paragraphs).nth(0).boundingBox())!;
  const third = (await page.locator(paragraphs).nth(2).boundingBox())!;
  const box = (await page.locator(scroller).boundingBox())!;
  await page.mouse.move(box.x + 12, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(third.x + 20, third.y + third.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  const text = await selected(page);
  expect(text).toMatch(/^First line\./);
  expect(text).toContain("Second line.");
});

// Where the press lands decides it: these places selected nothing before.
for (const [what, markdown, target, into] of [
  ["bold text", "Some **bold words** and more words here.", "strong", 0.5],
  ["a heading", "# A heading line with words", "h1", 0.15],
] as const)
  test(`a drag that starts on ${what} selects from there`, async ({ page }) => {
    await openApp(page, { settings: { language: "en" } });
    await pasteMarkdown(
      page,
      `${markdown}\n\nLast line of words to drag into.`,
    );
    const start = (await page
      .locator(`[data-active-tab="true"] .ProseMirror ${target}`)
      .boundingBox())!;
    const last = (await page.locator(paragraphs).last().boundingBox())!;
    await page.mouse.move(
      start.x + start.width * into,
      start.y + start.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(last.x + 150, last.y + last.height / 2, {
      steps: 8,
    });
    await page.mouse.up();
    expect(await selected(page)).toMatch(/\n+Last line/);
  });
