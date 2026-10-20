import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// Typing Markdown by hand and the keys around blocks: what each keystroke
// leaves in the document, read back from source mode.

const editor = '[data-active-tab="true"] .ProseMirror';

function emit(page: Page, name: string, payload?: unknown) {
  return page.evaluate(
    ([n, p]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload?: unknown) => void;
        }
      ).__devEmitTauriEvent(n as string, p),
    [name, payload] as const,
  );
}

async function sourceOf(page: Page): Promise<string> {
  await emit(page, "menu-toggle-source-mode");
  const textarea = page.locator(
    '[data-active-tab="true"] textarea.source-view',
  );
  await expect(textarea).toBeAttached();
  const value = await textarea.inputValue();
  await emit(page, "menu-toggle-source-mode");
  await expect(textarea).toHaveCount(0);
  return value.trim();
}

/** The app with `markdown` opened from a file (a paste could leave an
 *  empty line around it), or an empty document to type in. */
async function open(page: Page, markdown = "") {
  await openApp(page, { settings: { language: "en" } });
  if (!markdown) {
    await page.locator(editor).click();
    return;
  }
  const path = "/notes/keys.md";
  await page.evaluate(
    (files) =>
      ((window as unknown as Record<string, unknown>).__devFiles = files),
    { [path]: markdown },
  );
  await emit(page, "tauri://drag-drop", {
    paths: [path],
    position: { x: 0, y: 0 },
  });
  await expect(page.locator(`${editor} > *`).first()).toBeVisible();
  await expect(page.locator(editor)).not.toHaveText("");
}

test("* and *** start a list and a rule, as - and --- do; seven #s are no heading", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.type("* item", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("***", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("####### seven", { delay: 20 });
  await expect(page.locator(`${editor} li`)).toHaveText(["item"]);
  await expect(page.locator(`${editor} hr`)).toHaveCount(1);
  expect(await sourceOf(page)).toBe("* item\n\n---\n\n####### seven");
});

test("Shift+Enter in a heading starts a new line below it, in a code block a new line in it", async ({
  page,
}) => {
  await open(page, "# Title\n\n```\ncode\n```");
  await page.locator(`${editor} h1`).click();
  await page.keyboard.press("End");
  await page.keyboard.down("Shift");
  // Held, not pressed with Enter (block-keys-plugin.ts's SHIFT_OVERLAP_MS).
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await page.keyboard.up("Shift");
  await page.keyboard.type("body", { delay: 20 });
  await page.locator(`${editor} pre code`).click();
  await page.keyboard.press("End");
  await page.keyboard.down("Shift");
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await page.keyboard.up("Shift");
  await page.keyboard.type("more", { delay: 20 });
  expect(await sourceOf(page)).toBe("# Title\n\nbody\n\n```\ncode\nmore\n```");
});

test("text typed after a wikilink or inside inline code at Enter stays out of the node", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.type("See [[Note]] here", { delay: 20 });
  await expect(page.locator(`${editor} .wikilink`)).toHaveText("[[Note]]");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A `split` b", { delay: 20 });
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  expect(await sourceOf(page)).toBe("See [[Note]] here\n\nA `sp`\n\n`lit` b");
});

/** Once ProseMirror has read a selection made by the keyboard - it does
 *  from the selectionchange event that follows. */
const selectionRead = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );

/** The caret at the start of the code block's first line, from the
 *  paragraph above it. */
async function toCodeStart(page: Page) {
  await page.locator(`${editor} p`).getByText("Before").click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
}

test("Tab and Shift+Tab indent and outdent the selected lines of a code block, keeping the focus", async ({
  page,
}) => {
  await open(page, "Before\n\n```\none\ntwo\nthree\n```");
  await toCodeStart(page);
  // Down to the start of "three", which stays as it is.
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await selectionRead(page);
  await page.keyboard.press("Tab");
  expect(await sourceOf(page)).toBe("Before\n\n```\n  one\n  two\nthree\n```");
  await toCodeStart(page);
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(editor)).toBeFocused();
  expect(await sourceOf(page)).toBe("Before\n\n```\none\n  two\nthree\n```");
});

test("the arrows leave a table that starts or ends the document from any cell", async ({
  page,
}) => {
  await open(page, "| a | b |\n| - | - |\n| c | d |");
  await page.locator(`${editor} td p`).first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("below", { delay: 20 });
  await page.locator(`${editor} th p`).last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.type("above", { delay: 20 });
  expect(await sourceOf(page)).toBe(
    "above\n\n| a | b |\n| - | - |\n| c | d |\n\nbelow",
  );
});

test("~~~ opens a code block, --- on the first line front matter, 1) a list; === stays text", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.type("---", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("title: x", { delay: 20 });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("1) one", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("~~~py", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("x = 1", { delay: 20 });
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.keyboard.type("=== and ~~gone~~", { delay: 20 });
  await expect(page.locator(`${editor} mark`)).toHaveCount(0);
  expect(await sourceOf(page)).toBe(
    "---\ntitle: x\n---\n\n1. one\n\n```py\nx = 1\n```\n\n\\=== and ~~gone~~",
  );
});

test("Backspace at a heading's start makes it text; at a callout's first line it keeps the callout, then makes a plain quote", async ({
  page,
}) => {
  await open(page, "### Title\n\n> [!NOTE]\n> Body text\n");
  await page.locator(`${editor} h3`).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  await expect(page.locator(`${editor} h3`)).toHaveCount(0);
  // Down onto the callout's body line, the marker hidden above it.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  await expect(page.locator(`${editor} .md-alert`)).toHaveCount(1);
  await expect(page.locator(`${editor} p`).first()).toHaveText("Title");
  await page.keyboard.press("Backspace");
  await expect(page.locator(`${editor} .md-alert`)).toHaveCount(0);
  expect(await sourceOf(page)).toBe("Title\n\n> Body text");
});

test("Tab and Shift+Tab in a paragraph leave the focus in the text", async ({
  page,
}) => {
  await open(page, "Some text\n");
  await page.locator(`${editor} p`).first().click();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(editor)).toBeFocused();
  await page.keyboard.type("!", { delay: 20 });
  expect(await sourceOf(page)).toMatch(/!/);
});

test("Format › Ordered List turns a bullet list into one, every item", async ({
  page,
}) => {
  await open(page, "- one\n- two\n");
  await page.locator(`${editor} li`).first().click();
  await emit(page, "menu-insert-block", "ordered-list");
  expect(await sourceOf(page)).toBe("1. one\n2. two");
});

test("HTML, a <br> and a footnote reference typed out are saved as typed", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.type("a <kbd>K</kbd> b<br>c[^1] d", { delay: 20 });
  expect(await sourceOf(page)).toBe("a <kbd>K</kbd> b<br>c[^1] d");
});

test("Left steps one character onto inline HTML, as Right does", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.type("ab <b>XY</b> cd", { delay: 20 });
  // Back over "cd" and the space, onto "</b>": its source shows, the
  // caret after its ">".
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("!", { delay: 20 });
  // And one more: into the tag, not past "XY" and "<b>".
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("?", { delay: 20 });
  expect(await sourceOf(page)).toBe("ab <b>XY</?b>! cd");
});

test("one Right from before bold-italic is inside it, all its marks showing", async ({
  page,
}) => {
  await open(page, "ab ***XY*** cd\n");
  await page.locator(`${editor} p`).first().click();
  await page.keyboard.press("Home");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await expect(page.locator(`${editor} .enclosure-delimiter`)).toHaveText([
    "*",
    "**",
    "**",
    "*",
  ]);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("!", { delay: 20 });
  expect(await sourceOf(page)).toBe("ab ***!XY*** cd");
});

test("Enter before a space starts the new line without it", async ({
  page,
}) => {
  await open(page, "one two\n");
  await page.locator(`${editor} p`).first().click();
  await page.keyboard.press("Home");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  expect(await sourceOf(page)).toBe("one\n\ntwo");
});

test("Mod+B and Mod+I pressed again at the end of what was typed end it, and the text goes on", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type("bold");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type(" and ");
  await page.keyboard.press("ControlOrMeta+i");
  await page.keyboard.type("it");
  await page.keyboard.press("ControlOrMeta+i");
  await page.keyboard.type(" after");
  expect(await sourceOf(page)).toBe("**bold** and *it* after");
  // Inside the word it still takes the bold off.
  await page.locator(`${editor} strong`).click();
  await page.keyboard.press("ControlOrMeta+b");
  expect(await sourceOf(page)).toBe("bold and *it* after");
});
