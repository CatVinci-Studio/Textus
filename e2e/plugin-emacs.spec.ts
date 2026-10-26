import { expect, test, type Page } from "@playwright/test";
import { pasteMarkdown } from "./helpers";
import { hasPlugin, openWithPlugins } from "./plugin-helpers";

/**
 * The Emacs plugin (textus-plugins' catvinci.emacs) through the editor's
 * key capture (src/plugins/contributions/editor-input.ts): only its own keys are taken,
 * so typing stays the editor's; motions, the mark, kills into the kill
 * ring and yanks back, and undo.
 */

test.skip(!hasPlugin("catvinci.emacs"), "catvinci.emacs is not published yet");

const editor = '[data-active-tab="true"] .ProseMirror';
const status = ".window-bar .plugin-status-item";

async function open(
  page: Page,
  markdown: string,
  settings: Record<string, unknown> = {},
) {
  await openWithPlugins(page, {
    plugins: { "catvinci.emacs": ["editor.input"] },
    settings: { "catvinci.emacs": settings },
  });
  await pasteMarkdown(page, markdown);
  await expect(page.locator(status)).toContainText("Emacs");
  await page
    .locator(`${editor} p`)
    .first()
    .click({ position: { x: 1, y: 5 } });
  await page.keyboard.press("Home");
}

const keys = async (page: Page, sequence: string[]) => {
  for (const key of sequence) await page.keyboard.press(key);
};

const firstParagraph = (page: Page) => page.locator(`${editor} p`).first();

/** Waits for the caret to be `offset` characters into its text: a
 *  plugin's moves land a moment after its key. */
const caretAt = (page: Page, offset: number) =>
  expect
    .poll(() => page.evaluate(() => window.getSelection()?.anchorOffset))
    .toBe(offset);

test("typing stays the editor's, and M- keys move by words", async ({
  page,
}) => {
  await open(page, "one two three");
  await keys(page, ["Alt+f"]);
  await caretAt(page, 3);
  await page.keyboard.type(" and");
  await expect(firstParagraph(page)).toHaveText("one and two three");
  await keys(page, ["Alt+b", "Alt+b"]);
  await caretAt(page, 0);
  await page.keyboard.type("X");
  await expect(firstParagraph(page)).toHaveText("Xone and two three");
});

test("M-d kills a word, and C-y yanks it back", async ({ page }) => {
  await open(page, "alpha beta gamma", { ctrlKeys: true });
  await keys(page, ["Alt+d"]);
  await expect(firstParagraph(page)).toHaveText(" beta gamma");
  await keys(page, ["Control+e"]);
  await keys(page, ["Control+y"]);
  await expect(firstParagraph(page)).toHaveText(" beta gammaalpha");
  await keys(page, ["Control+/"]);
  await expect(firstParagraph(page)).toHaveText(" beta gamma");
});

test("C-k kills to the line's end; C-SPC and a motion mark a region C-w kills", async ({
  page,
}) => {
  await open(page, "first line here\n\nsecond", { ctrlKeys: true });
  await keys(page, ["Alt+f", "Control+k"]);
  await expect(firstParagraph(page)).toHaveText("first");
  await keys(page, ["Control+a", "Control+ ", "Alt+f"]);
  await expect(page.locator(status)).toContainText("Mark");
  await keys(page, ["Control+w"]);
  await expect(firstParagraph(page)).toHaveText("");
  await expect(page.locator(status)).not.toContainText("Mark");
  // Both kills are in the ring: C-y the newest, M-y the one before.
  await keys(page, ["Control+y"]);
  await expect(firstParagraph(page)).toHaveText("first");
  await keys(page, ["Alt+y"]);
  await expect(firstParagraph(page)).toHaveText(" line here");
});

test("without the Ctrl setting, Ctrl keys stay the app's on Windows and Linux", async ({
  page,
}) => {
  await open(page, "plain text");
  await keys(page, ["Control+e"]);
  await page.keyboard.type("!");
  // C-e didn't move to the end: the typing went in at the start.
  await expect(firstParagraph(page)).toHaveText("!plain text");
});

test("M-u, M-c and M-l recase the next word", async ({ page }) => {
  await open(page, "one two three", { ctrlKeys: true });
  await keys(page, ["Alt+u"]);
  await expect(firstParagraph(page)).toHaveText("ONE two three");
  await keys(page, ["Alt+c"]);
  await expect(firstParagraph(page)).toHaveText("ONE Two three");
  await keys(page, ["Alt+l"]);
  await expect(firstParagraph(page)).toHaveText("ONE Two three");
  await keys(page, ["Alt+b", "Alt+b", "Alt+l"]);
  await expect(firstParagraph(page)).toHaveText("ONE two three");
});
