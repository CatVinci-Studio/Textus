import { expect, test, type Page } from "@playwright/test";
import { pasteMarkdown } from "./helpers";
import { hasPlugin, openWithPlugins } from "./plugin-helpers";

/**
 * The Vim plugin (textus-plugins' catvinci.vim) through the editor's key
 * capture (src/plugins/contributions/editor-input.ts): normal mode's keys never type,
 * motions and operators edit as typing does, insert mode types, u undoes,
 * and flash jumps to a label.
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
  await expect(page.locator(status)).toContainText("INSERT");
  await page.keyboard.type("X ");
  await keys(page, ["Escape"]);
  await expect(page.locator(status)).toContainText("NORMAL");
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

test("flash: s and two letters label each place, and a label jumps there", async ({
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
  await page.keyboard.type("ONE");
  await keys(page, ["Escape"]);
  await expect(firstParagraph(page)).toHaveText("def ONE two three");
  await keys(page, ["w", "l", "c", "i", "w"]);
  await page.keyboard.type("2");
  await keys(page, ["Escape"]);
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
