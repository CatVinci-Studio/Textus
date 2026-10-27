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

test("line numbers sit beside their lines, a long line wrapping as without them (#353)", async ({
  page,
}) => {
  await openWithCode(page, { codeLineNumbers: true }, LISTING);
  const numbers = page.locator(`${block} .code-line-gutter > span`);
  await expect(numbers).toHaveCount(39);
  await expect(numbers.last()).toHaveText("39");
  // The long line wraps: more rows than lines, and nothing to scroll.
  expect((await codeLineMiddles(page)).length).toBeGreaterThan(39);
  const code = page.locator(`${block} code`);
  expect(await code.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  // Each number at the top of its line, the wrapped one's too, and as tall
  // as all of the line's rows.
  await expect(async () => {
    const { tops, boxes } = await code.evaluate((el) => {
      const starts: number[] = [];
      const range = document.createRange();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let lineStart = true;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text;
        for (let i = 0; i < text.data.length; i++) {
          if (lineStart) {
            range.setStart(text, i);
            range.setEnd(text, i + 1);
            starts.push(range.getClientRects()[0].top);
            lineStart = false;
          }
          if (text.data[i] === "\n") lineStart = true;
        }
      }
      const spans = el.parentElement!.querySelectorAll(
        ".code-line-gutter > span",
      );
      return {
        tops: starts,
        boxes: Array.from(spans, (span) => {
          const box = span.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom };
        }),
      };
    });
    expect(tops).toHaveLength(39);
    for (let i = 0; i < 39; i++) {
      expect(Math.abs(boxes[i].top - tops[i]), `line ${i + 1}`).toBeLessThan(4);
      if (i < 38)
        expect(
          Math.abs(boxes[i].bottom - tops[i + 1]),
          `line ${i + 1} ends where line ${i + 2} starts`,
        ).toBeLessThan(4);
    }
  }).toPass();
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

test("Select All in a document that opens with a code block selects its text", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "```js\n" + CODE + "\n```");
  await page.locator(`${block} code`).click();
  // Edit > Select All, as the macOS menu sends it.
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("textus:edit-action", { detail: "select-all" }),
    ),
  );
  // WebKit highlights a selection between characters, not one beside the
  // block's buttons.
  const ends = await page.evaluate(() => {
    const s = getSelection()!;
    return [s.anchorNode?.nodeType, s.focusNode?.nodeType, s.toString()];
  });
  expect(ends).toEqual([3, 3, CODE]);
});
