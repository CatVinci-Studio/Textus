import { expect, test, type Page } from "@playwright/test";
import { pasteMarkdown } from "./helpers";
import { hasPlugin, openWithPlugins } from "./plugin-helpers";

/**
 * The Vim plugin through the editor's key capture: normal mode's keys
 * never type.
 */

test.skip(!hasPlugin("catvinci.vim"), "catvinci.vim is not published yet");

const editor = '[data-active-tab="true"] .ProseMirror';
const status = ".window-bar .plugin-status-item";

async function open(page: Page, markdown: string) {
  await openWithPlugins(page, {
    plugins: { "catvinci.vim": ["editor.input"] },
  });
  await pasteMarkdown(page, markdown);
  await expect(page.locator(status)).toContainText("NORMAL");
  // The caret at the start of the first paragraph.
  await page
    .locator(`${editor} p`)
    .first()
    .click({ position: { x: 1, y: 5 } });
  await page.keyboard.press("0");
}

const keys = async (page: Page, sequence: string[]) => {
  for (const key of sequence) await page.keyboard.press(key);
};

/** Waits for the mode a key switched to: the plugin takes the keys of the
 *  new mode a moment after, and a key sent before goes to the old one. */
const inMode = (page: Page, mode: "NORMAL" | "INSERT") =>
  expect(page.locator(status)).toContainText(mode);

const firstParagraph = (page: Page) => page.locator(`${editor} p`).first();

test("normal mode's keys move and edit, and never type", async ({ page }) => {
  await open(page, "one two three");
  await keys(page, ["w", "d", "w"]);
  await expect(firstParagraph(page)).toHaveText("one three");
  await keys(page, ["x"]);
  await expect(firstParagraph(page)).toHaveText("one hree");
  await keys(page, ["u"]);
  await expect(firstParagraph(page)).toHaveText("one three");
  // A letter with no meaning in Vim types nothing.
  await keys(page, ["q"]);
  await expect(firstParagraph(page)).toHaveText("one three");
});

test("insert mode types, Escape goes back, and dot repeats a change", async ({
  page,
}) => {
  await open(page, "alpha beta gamma delta");
  await keys(page, ["i"]);
  await inMode(page, "INSERT");
  await page.keyboard.type("X ");
  await keys(page, ["Escape"]);
  await inMode(page, "NORMAL");
  await expect(firstParagraph(page)).toHaveText("X alpha beta gamma delta");
  await keys(page, ["0", "d", "w"]);
  await expect(firstParagraph(page)).toHaveText("alpha beta gamma delta");
  await keys(page, ["."]);
  await expect(firstParagraph(page)).toHaveText("beta gamma delta");
});

test("dd deletes a line and p puts it back below", async ({ page }) => {
  await open(page, "first\n\nsecond\n\nthird");
  await keys(page, ["d", "d"]);
  await expect(page.locator(`${editor} p`)).toHaveText(["second", "third"]);
  await keys(page, ["p"]);
  await expect(page.locator(`${editor} p`)).toHaveText([
    "second",
    "first",
    "third",
  ]);
});

test("flash: s and a letter label each place, and a label jumps there", async ({
  page,
}) => {
  await open(page, "the cat sat on the mat by the hat");
  await keys(page, ["s", "a", "t"]);
  const labels = page.locator(`${editor} .plugin-flash-label`);
  await expect(labels).toHaveCount(4);
  const second = (await labels.nth(1).textContent())!;
  await keys(page, [second]);
  await expect(labels).toHaveCount(0);
  // The caret is on "sat"'s "a": x takes it.
  await keys(page, ["x"]);
  await expect(firstParagraph(page)).toHaveText(
    "the cat st on the mat by the hat",
  );
});

test("counts, cw, ciw, f and visual mode", async ({ page }) => {
  await open(page, "abcdef one two three");
  await keys(page, ["3", "x"]);
  await expect(firstParagraph(page)).toHaveText("def one two three");
  await keys(page, ["w", "c", "w"]);
  await inMode(page, "INSERT");
  await page.keyboard.type("ONE");
  await keys(page, ["Escape"]);
  await inMode(page, "NORMAL");
  await expect(firstParagraph(page)).toHaveText("def ONE two three");
  await keys(page, ["w", "l", "c", "i", "w"]);
  await inMode(page, "INSERT");
  await page.keyboard.type("2");
  await keys(page, ["Escape"]);
  await inMode(page, "NORMAL");
  await expect(firstParagraph(page)).toHaveText("def ONE 2 three");
  await keys(page, ["0", "d", "f", "E"]);
  await expect(firstParagraph(page)).toHaveText(" 2 three");
  await keys(page, ["$", "v", "b", "d"]);
  await expect(page.locator(status)).toContainText("NORMAL");
  await expect(firstParagraph(page)).toHaveText(" 2 ");
});

test("~ flips the case under the caret, and U and u recase a selection", async ({
  page,
}) => {
  await open(page, "hello world");
  await keys(page, ["~"]);
  await expect(firstParagraph(page)).toHaveText("Hello world");
  await keys(page, ["3", "~"]);
  await expect(firstParagraph(page)).toHaveText("HELLo world");
  await keys(page, ["u"]);
  await expect(firstParagraph(page)).toHaveText("Hello world");
  await keys(page, ["$", "v", "b", "U"]);
  await expect(page.locator(status)).toContainText("NORMAL");
  await expect(firstParagraph(page)).toHaveText("Hello WORLD");
  await keys(page, ["$", "v", "b", "u"]);
  await expect(firstParagraph(page)).toHaveText("Hello world");
});

test("the block cursor is there from the start, and in a tab opened later", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.vim": ["editor.input"] },
  });
  // Vim starts before the editor has had the focus.
  await expect(page.locator(status)).toContainText("NORMAL");
  await page.locator(editor).click();
  await expect(page.locator(editor)).toHaveClass(/plugin-cursor-block/);
  await page.keyboard.press("ControlOrMeta+t");
  await page.locator(editor).click();
  await expect(page.locator(editor)).toHaveClass(/plugin-cursor-block/);
});

test("zz, zt and zb bring the caret's line to the middle, top and bottom", async ({
  page,
}) => {
  const lines = Array.from({ length: 80 }, (_, i) => `Line ${i + 1}`);
  await open(page, lines.join("\n\n"));
  await keys(page, ["4", "0", "j"]);
  const where = () =>
    page.evaluate(() => {
      const scroller = document.querySelector(
        '[data-active-tab="true"] .editor-scroll',
      )!;
      const caret = document.querySelector(
        '[data-active-tab="true"] .plugin-block-cursor',
      )!;
      const box = scroller.getBoundingClientRect();
      const line = caret.getBoundingClientRect();
      return (line.top + line.height / 2 - box.top) / box.height;
    });
  await keys(page, ["z", "z"]);
  await expect.poll(where).toBeGreaterThan(0.4);
  expect(await where()).toBeLessThan(0.6);
  await keys(page, ["z", "t"]);
  await expect.poll(where).toBeLessThan(0.15);
  await keys(page, ["z", "b"]);
  await expect.poll(where).toBeGreaterThan(0.85);
});
