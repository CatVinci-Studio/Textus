import { expect, test, type Page } from "@playwright/test";
import { pasteMarkdown } from "./helpers";
import { hasPlugin, openWithPlugins } from "./plugin-helpers";

/** The Vim plugin across a Markdown document's blocks. */

test.skip(!hasPlugin("catvinci.vim"), "catvinci.vim is not published yet");

const editor = '[data-active-tab="true"] .ProseMirror';
const status = ".window-bar .plugin-status-item";

const DOC = [
  "# Title here",
  "",
  "First paragraph line.",
  "",
  "- item one",
  "- item two",
  "",
  "> quoted words",
  "",
  "```",
  "code one",
  "code two",
  "```",
  "",
  "Last paragraph.",
].join("\n");

async function open(
  page: Page,
  markdown: string,
  settings: Record<string, unknown> = {},
) {
  await openWithPlugins(page, {
    plugins: { "catvinci.vim": ["editor.input"] },
    settings: { "catvinci.vim": settings },
  });
  await pasteMarkdown(page, markdown);
  await expect(page.locator(status)).toContainText("NORMAL");
  await page
    .locator(`${editor} > *`)
    .first()
    .click({ position: { x: 1, y: 5 } });
  await page.keyboard.press("0");
}

/** The text of the line the caret is on: its block, or a code line. */
const caretLine = (page: Page) =>
  page.evaluate(() => {
    const sel = window.getSelection()!;
    let node: Node | null = sel.anchorNode;
    while (
      node &&
      !(node instanceof HTMLElement && /^(H\d|P|PRE)$/.test(node.tagName))
    )
      node = node.parentNode;
    const el = node as HTMLElement | null;
    if (!el) return "";
    if (el.tagName !== "PRE") return el.textContent ?? "";
    const range = document.createRange();
    range.setStart(el, 0);
    range.setEnd(sel.anchorNode!, sel.anchorOffset);
    const before = range.toString();
    const all = el.textContent ?? "";
    const start = before.lastIndexOf("\n") + 1;
    const end = all.indexOf("\n", before.length);
    return all.slice(start, end < 0 ? undefined : end);
  });

async function walk(page: Page, key: string, times: number) {
  const seen: string[] = [];
  let line = await caretLine(page);
  for (let n = 0; n < times; n++) {
    const before = line;
    await page.keyboard.press(key);
    await expect.poll(() => caretLine(page)).not.toBe(before);
    line = await caretLine(page);
    seen.push(line);
  }
  return seen;
}

test("j and k go through every block, code blocks too, both ways", async ({
  page,
}) => {
  await open(page, DOC);
  expect(await walk(page, "j", 7)).toEqual([
    "First paragraph line.",
    "item one",
    "item two",
    "quoted words",
    "code one",
    "code two",
    "Last paragraph.",
  ]);
  expect(await walk(page, "k", 7)).toEqual([
    "code two",
    "code one",
    "quoted words",
    "item two",
    "item one",
    "First paragraph line.",
    "# Title here",
  ]);
});

test("j keeps its column; } goes block by block; dw stops at the line's end", async ({
  page,
}) => {
  await open(page, "abcdefgh\n\nab\n\nabcdefgh\n\none two\n\nthree");
  await page.keyboard.press("5");
  await page.keyboard.press("l");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.keyboard.press("x");
  // Back at column 6 after the short line.
  await expect(page.locator(`${editor} p`).nth(2)).toHaveText("abcdegh");
  await page.keyboard.press("}");
  await expect.poll(() => caretLine(page)).toBe("one two");
  await page.keyboard.press("w");
  await page.keyboard.press("d");
  await page.keyboard.press("w");
  await expect(page.locator(`${editor} p`).nth(3)).toHaveText("one ");
  await expect(page.locator(`${editor} p`).nth(4)).toHaveText("three");
});

test("flash lights what is typed, labels the nearest first, and ds deletes to a label", async ({
  page,
}) => {
  const lines = Array.from(
    { length: 12 },
    (_, i) => `Line ${i} has some words.`,
  );
  await open(page, lines.join("\n\n"));
  await page.keyboard.press("G");
  await page.keyboard.press("s");
  await page.keyboard.press("w");
  // One character lights the places and labels them.
  await expect(page.locator(".plugin-flash-match").first()).toBeVisible();
  await expect(
    page.locator(`${editor} p`).last().locator(".plugin-flash-label"),
  ).toHaveText("a");
  await page.keyboard.press("o");
  // The nearest place - on the caret's own line - gets the first letter.
  const last = page.locator(`${editor} p`).last();
  await expect(last.locator(".plugin-flash-label")).toHaveText("a");
  // A letter that's no label narrows the search: "wor" is still found.
  await page.keyboard.press("r");
  await expect(last.locator(".plugin-flash-label")).toHaveText("a");
  await page.keyboard.press("a");
  await expect(page.locator(".plugin-flash-label")).toHaveCount(0);
  // The caret is on "words": dw takes it.
  await page.keyboard.press("d");
  await page.keyboard.press("w");
  await expect(last).toHaveText("Line 11 has some .");
  // d, s, two letters, a label: deleted from the caret to there.
  await page.keyboard.press("0");
  await page.keyboard.press("d");
  await page.keyboard.press("s");
  await page.keyboard.press("h");
  await page.keyboard.press("a");
  await page.keyboard.press("a");
  await expect(last).toHaveText("has some .");
});

test("the command line in the palette: :12 goes to a line, :q closes the tab, an unknown one says so", async ({
  page,
}) => {
  await open(page, "one\n\ntwo\n\nthree");
  const palette = page.getByRole("dialog", {
    name: "Vim command, or search the commands",
  });
  const box = palette.getByRole("combobox");
  // ":" opens the palette; what follows is typed into it.
  const command = async (text: string) => {
    await page.keyboard.type(":");
    await expect(box).toHaveValue(":");
    await page.keyboard.type(text);
  };
  await command("3");
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect.poll(() => caretLine(page)).toBe("three");
  await expect(page.locator(status)).toContainText("NORMAL");
  await command("nope");
  await page.keyboard.press("Enter");
  await expect(page.locator(status)).toContainText("Not a command here: nope");
  // Escape leaves the palette, running nothing.
  await command("wq");
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(page.locator(`${editor} p`).last()).toHaveText("three");
  // Vim's own come first; :q on an unsaved document asks first, as File ›
  // Close Tab does.
  await command("q");
  await expect(palette.getByRole("option").first()).toContainText(":q");
  await page.keyboard.press("Enter");
  await expect(page.locator(".close-prompt-discard")).toBeVisible();
});

test("vimrc mappings: inoremap jj <Esc> and a leader mapping", async ({
  page,
}) => {
  await open(page, "alpha", {
    mappings: [
      '" my vimrc',
      'let mapleader = ","',
      "inoremap jj <Esc>",
      "nnoremap <leader>d dd",
      "nnoremap H 0",
    ].join("\n"),
  });
  await page.keyboard.press("A");
  await expect(page.locator(status)).toContainText("INSERT");
  await page.keyboard.type(" beta");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(page.locator(status)).toContainText("NORMAL");
  await expect(page.locator(`${editor} p`).first()).toHaveText("alpha beta");
  // A single j in insert mode is typed, after a moment.
  await page.keyboard.press("a");
  await page.keyboard.press("j");
  await page.keyboard.press("Escape");
  await expect(page.locator(`${editor} p`).first()).toHaveText("alpha betaj");
  await page.keyboard.press("H");
  await page.keyboard.press("x");
  await expect(page.locator(`${editor} p`).first()).toHaveText("lpha betaj");
  await page.keyboard.press(",");
  await page.keyboard.press("d");
  await expect(page.locator(`${editor} p`).first()).not.toHaveText(
    "lpha betaj",
  );
});

test("j goes on past the bottom of the window; flash labels only what is seen", async ({
  page,
}) => {
  const lines = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}.`);
  await open(page, lines.join("\n\n"));
  for (let n = 0; n < 45; n++) await page.keyboard.press("j");
  await expect.poll(() => caretLine(page)).toBe("Paragraph 45.");
  // By place: a label's letter becomes part of the paragraph's text.
  const here = page.locator(`${editor} p`).nth(45);
  await expect(here).toBeInViewport();
  await page.keyboard.press("s");
  await page.keyboard.press("p");
  await page.keyboard.press("a");
  // The caret's own line gets the first label; none goes off screen.
  await expect(here.locator(".plugin-flash-label")).toHaveCount(1);
  await expect(here.locator(".plugin-flash-label")).toHaveText("a");
  for (const label of await page.locator(".plugin-flash-label").all())
    await expect(label).toBeInViewport();
});
