import { expect, test, type Page } from "@playwright/test";
import { END, openApp, pasteMarkdown } from "./helpers";

// A code block's copy and select buttons, its language picker, and the
// line numbers Settings › Editor & Appearance can turn on (off by default).

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
  browserName,
}) => {
  test.skip(browserName === "webkit", "WebKit has no clipboard permission");
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

test("the language, copy and select buttons sit in the block's top-right corner", async ({
  page,
}) => {
  await openWithCode(page, {});
  await page.locator(block).hover();
  const box = (await page.locator(block).boundingBox())!;
  const actions = (await page
    .locator(`${block} .code-block-actions`)
    .boundingBox())!;
  expect(box.y + box.height - (actions.y + actions.height)).toBeGreaterThan(
    box.height / 2,
  );
  expect(box.x + box.width - (actions.x + actions.width)).toBeLessThan(12);
  await page.locator(`${block} .code-block-select-all`).click();
  expect(await page.evaluate(() => getSelection()!.toString())).toBe(CODE);
});

test("the language search stays on top of the list as it scrolls", async ({
  page,
}) => {
  await openWithCode(page, {}, "print(1)");
  await page.locator(block).hover();
  await page.locator(`${block} .code-block-language-select`).click();
  const list = page.getByRole("listbox");
  await list.evaluate((el) => (el.scrollTop = 40));
  const search = page.locator(".code-language-search input");
  const box = (await search.boundingBox())!;
  const top = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.tagName,
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(top).toBe("INPUT");
});

test("the language is picked from the app's own menu, and the colours follow at once", async ({
  page,
}) => {
  await openWithCode(page, {}, '{\n  "a": 1\n}');
  await page.locator(block).hover();
  await expect(page.locator(`${block} select`)).toHaveCount(0);
  const picker = page.locator(`${block} .code-block-language-select`);
  await expect(picker).toHaveText("js");
  await picker.click();
  await page.getByRole("option", { name: "plain text" }).click();
  await expect(page.locator(`${block} code .token`)).toHaveCount(0);
  await page.locator(block).hover();
  await picker.click();
  await page.getByRole("option", { name: "json", exact: true }).click();
  await expect(picker).toHaveText("json");
  await expect(
    page.locator(`${block} code .token.property`, { hasText: '"a"' }),
  ).toHaveCount(1);
  // Typed into the menu's search, Enter takes the first match.
  await page.locator(block).hover();
  await picker.click();
  await page.keyboard.type("yam");
  await expect(page.getByRole("option")).toHaveText(["yaml", "yam"]);
  await page.keyboard.press("Enter");
  await expect(picker).toHaveText("yaml");
});

test("pasted code keeps its lines, Chinese comments and long lines too", async ({
  page,
}) => {
  const lines = Array.from({ length: 12 }, (_, i) =>
    i % 3
      ? `call(${i}); // a line of code that runs on a while`
      : `  // 第 ${i} 行，中文注释`,
  );
  await openWithCode(page, {}, lines.join("\n"));
  await expect(page.locator(`${block} code`)).toHaveText(lines.join("\n"));
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
  // The long line wraps.
  const lines = await codeLineMiddles(page);
  expect(lines.length).toBeGreaterThan(4);
});

for (const zoom of [1, 1.25])
  test(`line numbers sit beside their lines, a long line wrapping as without them, at ${zoom * 100}% (#353)`, async ({
    page,
  }) => {
    await openWithCode(page, { codeLineNumbers: true, zoom }, LISTING);
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
        expect(Math.abs(boxes[i].top - tops[i]), `line ${i + 1}`).toBeLessThan(
          4,
        );
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
  await page.keyboard.press(END);
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
