import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

// A code block's copy button, beside its language picker, and the line
// numbers Settings › Editor & Appearance can turn on (off by default).

const editor = '[data-active-tab="true"] .ProseMirror';
const block = `${editor} .code-block-wrapper`;

const LONG = `const line = "${"a very long line of code that runs on ".repeat(6)}";`;
const CODE = ["function greet() {", "  return 1;", LONG, "}"].join("\n");
// Long enough that numbers a pixel off per line would end a line away.
const LISTING = [
  "function count() {",
  LONG,
  ...Array.from({ length: 36 }, (_, i) => `  step(${i + 1});`),
  "}",
].join("\n");

async function openWithCode(
  page: Page,
  settings: Record<string, unknown>,
  code = CODE,
) {
  await openApp(page, { settings: { language: "en", ...settings } });
  await pasteMarkdown(page, "Before\n\n```js\n" + code + "\n```\n\nAfter");
  await expect(page.locator(block)).toHaveCount(1);
}

test("the copy button copies the block's code and says so", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openWithCode(page, {});
  await page.locator(block).hover();
  const copy = page.locator(`${block} .code-block-copy`);
  await expect(copy).toHaveText("Copy");
  await copy.click();
  await expect(copy).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CODE);
  // Its label is chrome: the document is unchanged.
  await expect(page.locator(`${block} code`)).toHaveText(CODE);
});

test("the header and line numbers stay out of a printout", async ({ page }) => {
  await openWithCode(page, { codeLineNumbers: true });
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(`${block} .code-block-header`)).toBeHidden();
  await expect(page.locator(`${block} .code-line-gutter`)).toBeHidden();
});

test("line numbers are off by default", async ({ page }) => {
  await openWithCode(page, {});
  await expect(page.locator(`${block} .code-line-gutter`)).toHaveCount(0);
  // The long line wraps, as it always has.
  const lines = await codeLineMiddles(page);
  expect(lines.length).toBeGreaterThan(4);
});

test("line numbers sit beside their lines, a long line scrolling instead of wrapping", async ({
  page,
}) => {
  await openWithCode(page, { codeLineNumbers: true }, LISTING);
  const numbers = page.locator(`${block} .code-line-gutter > span`);
  await expect(numbers).toHaveCount(39);
  await expect(numbers.last()).toHaveText("39");
  const lines = await codeLineMiddles(page);
  // One visual line per line, the long one too: no wrapping.
  expect(lines).toHaveLength(39);
  const mids = await numbers.evaluateAll((spans) =>
    spans.map((span) => {
      const box = span.getBoundingClientRect();
      return box.top + box.height / 2;
    }),
  );
  for (let i = 0; i < 39; i++)
    expect(Math.abs(mids[i] - lines[i]), `line ${i + 1}`).toBeLessThan(4);
  // The code scrolls sideways; the numbers stay where they are.
  const code = page.locator(`${block} code`);
  expect(await code.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
  const before = await numbers.first().boundingBox();
  await code.evaluate((el) => (el.scrollLeft = 200));
  expect(await code.evaluate((el) => el.scrollLeft)).toBe(200);
  const after = await numbers.first().boundingBox();
  expect(after!.x).toBeCloseTo(before!.x, 0);
});

test("a line typed into the block gets its number", async ({ page }) => {
  await openWithCode(page, { codeLineNumbers: true });
  await page.locator(`${block} code .token`, { hasText: "return" }).click();
  // The editor reads a moved caret on the next selectionchange: a key
  // pressed at once would act where the caret was before.
  await page.waitForTimeout(100);
  await page.keyboard.press("End");
  await page.waitForTimeout(100);
  await page.keyboard.press("Enter");
  await page.keyboard.type("return 2;");
  await expect(page.locator(`${block} .code-line-gutter > span`)).toHaveText([
    "1",
    "2",
    "3",
    "4",
    "5",
  ]);
});

/** The middle of each visual line of the block's code, in page px. */
function codeLineMiddles(page: Page): Promise<number[]> {
  return page.locator(`${block} code`).evaluate((code) => {
    const range = document.createRange();
    range.selectNodeContents(code);
    const middles: number[] = [];
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width === 0) continue;
      const mid = rect.top + rect.height / 2;
      if (!middles.some((m) => Math.abs(m - mid) < 2)) middles.push(mid);
    }
    return middles.sort((a, b) => a - b);
  });
}
