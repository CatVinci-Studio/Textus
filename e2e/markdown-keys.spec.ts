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
  // No ghost text: a suggestion arriving mid-flow, under load, moves the
  // caret and the selection these flows read.
  await openApp(page, {
    settings: { language: "en", enableCompletion: false },
  });
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

test("Mod+B and Mod+I on a selection keep it selected, so they add up and come off again", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.type("hello world");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
  const selected = () => page.evaluate(() => getSelection()?.toString());
  await expect.poll(selected).toBe("world");
  await page.keyboard.press("ControlOrMeta+b");
  await expect.poll(selected).toBe("world");
  await page.keyboard.press("ControlOrMeta+i");
  await expect.poll(selected).toBe("world");
  expect(await sourceOf(page)).toBe("hello ***world***");
  // Source mode put the caret elsewhere: select the word again, by a
  // double click this time.
  await page.locator(`${editor} em`).dblclick();
  await expect.poll(selected).toBe("world");
  await page.keyboard.press("ControlOrMeta+b");
  await expect.poll(selected).toBe("world");
  await page.keyboard.press("ControlOrMeta+i");
  await expect.poll(selected).toBe("world");
  expect(await sourceOf(page)).toBe("hello world");
});

test("a double click on a bold or italic word selects that word", async ({
  page,
}) => {
  // The first press reveals the span's ** and moves the text along; WebKit
  // took the second press for a delimiter or the next word.
  await open(page, "plain **bold** and *it* here, **粗体文字**");
  const selected = () => page.evaluate(() => getSelection()?.toString());
  await page.locator(`${editor} strong`).first().dblclick();
  await expect.poll(selected).toBe("bold");
  await page.locator(`${editor} em`).dblclick();
  await expect.poll(selected).toBe("it");
  // Bold-italic is italic around bold: a double click at the word's edge,
  // between the two spans, still finds it in the inner one.
  await open(page, "edge ***world*** here");
  await page.locator(`${editor} em`).dblclick({ position: { x: 1, y: 8 } });
  await expect.poll(selected).toBe("world");
  await open(page, "plain **bold** and *it* here, **粗体文字**");
  // Chinese is cut into words, as a double click on plain text cuts it:
  // the first word, never a delimiter.
  await page
    .locator(`${editor} strong`)
    .nth(1)
    .dblclick({ position: { x: 4, y: 8 } });
  const word = await selected();
  expect(word).toMatch(/^粗/);
  expect("粗体文字".startsWith(word!)).toBe(true);
});

test("~~ and == stay as typed until their closing pair makes a strikethrough or a highlight", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.type("~~", { delay: 20 });
  // Two tildes, not an empty strikethrough drawn as four.
  await expect(page.locator(editor)).toHaveText("~~");
  await expect(page.locator(`${editor} del`)).toHaveCount(0);
  await page.keyboard.type("gone~~ and ==kept== ok", { delay: 20 });
  await expect(page.locator(`${editor} del`)).toHaveText("gone");
  await expect(page.locator(`${editor} mark`)).toHaveText("kept");
  expect(await sourceOf(page)).toBe("~~gone~~ and ==kept== ok");
});

test("Backspace at a code block's start and Delete before it move the caret, leaving the block whole", async ({
  page,
}) => {
  await open(page, "Before\n\n```js\none\ntwo\n```");
  await page.locator(`${editor} pre code`).getByText("one").click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+ArrowLeft" : "Home",
  );
  await selectionRead(page);
  await page.keyboard.press("Backspace");
  await page.keyboard.type("!", { delay: 20 });
  await page.keyboard.press("Delete");
  await page.keyboard.type("x", { delay: 20 });
  expect(await sourceOf(page)).toBe("Before!\n\n```js\nxone\ntwo\n```");
});

test("Delete before a table goes into its first cell", async ({ page }) => {
  await open(page, "Before\n\n| a | b |\n| - | - |\n| c | d |");
  await page.locator(`${editor} p`).getByText("Before").click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+ArrowRight" : "End",
  );
  await page.keyboard.press("Delete");
  await page.keyboard.type("x", { delay: 20 });
  expect(await sourceOf(page)).toBe(
    "Before\n\n| xa | b |\n| -- | - |\n| c  | d |",
  );
});

test("Delete before a quote joins its first line", async ({ page }) => {
  await open(page, "Above\n\n> one\n>\n> two");
  await page.locator(`${editor} p`).getByText("Above").click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+ArrowRight" : "End",
  );
  await page.keyboard.press("Delete");
  expect(await sourceOf(page)).toBe("Aboveone\n\n> two");
});

test("Enter in a code block in a list adds a line, and an indented blank line keeps the block", async ({
  page,
}) => {
  await open(page, "- item\n\n  ```py\n  def f():\n      x = 1\n  ```");
  await page.locator(`${editor} pre code`).click();
  // The caret after "x = 1", the code's last line.
  await page.evaluate((sel) => {
    const code = document.querySelector(`${sel} pre code`)!;
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) last = n as Text;
    getSelection()!.collapse(last!, last!.data.length);
  }, editor);
  await selectionRead(page);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("y = 2", { delay: 20 });
  expect(await sourceOf(page)).toBe(
    "- item\n\n  ```py\n  def f():\n      x = 1\n\n      y = 2\n  ```",
  );
});

test("typing over a selection that ends in a code block keeps the code block", async ({
  page,
}) => {
  await open(page, "Before\n\n```js\none\ntwo\n```");
  await page.locator(`${editor} p`).getByText("Before").click();
  // From the start of "Before" to the end of "one".
  await page.evaluate((sel) => {
    const p = document.querySelector(`${sel} p`)!.firstChild!;
    const code = document.querySelector(`${sel} pre code`)!;
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    let one = walker.nextNode() as Text;
    while (!one.data.includes("one")) one = walker.nextNode() as Text;
    getSelection()!.setBaseAndExtent(p, 0, one, one.data.indexOf("one") + 3);
  }, editor);
  await selectionRead(page);
  await page.keyboard.type("Z", { delay: 20 });
  expect(await sourceOf(page)).toBe("Z\n\n```js\n\ntwo\n```");
});

test("Delete before a callout puts the caret at its text, keeping the callout", async ({
  page,
}) => {
  await open(page, "Above\n\n> [!NOTE]\n> body");
  await page.locator(`${editor} p`).getByText("Above").click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+ArrowRight" : "End",
  );
  await page.keyboard.press("Delete");
  await page.keyboard.type("x", { delay: 20 });
  expect(await sourceOf(page)).toBe("Above\n\n> [!NOTE]\n> xbody");
});

test("Enter in a code block in a list adds a line, and an indented blank line keeps the block", async ({
  page,
}) => {
  await open(page, "- item\n\n  ```py\n  def f():\n      x = 1\n  ```");
  await page.locator(`${editor} pre code`).click();
  // The caret after "x = 1", the code's last line.
  await page.evaluate((sel) => {
    const code = document.querySelector(`${sel} pre code`)!;
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) last = n as Text;
    getSelection()!.collapse(last!, last!.data.length);
  }, editor);
  await selectionRead(page);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("y = 2", { delay: 20 });
  expect(await sourceOf(page)).toBe(
    "- item\n\n  ```py\n  def f():\n      x = 1\n\n      y = 2\n  ```",
  );
});

test("``` and $$ typed in a list item start a code block and a maths block in it", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.type("- item", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("```js", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("x", { delay: 20 });
  await expect(page.locator(`${editor} li pre`)).toHaveCount(1);
  expect(await sourceOf(page)).toBe("* item\n* ```js\n  x\n  ```");

  await open(page);
  await page.keyboard.type("- item", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("$$", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("y", { delay: 20 });
  await expect(page.locator(`${editor} li .math-block`)).toHaveCount(1);
  expect(await sourceOf(page)).toBe("* item\n* $$\n  y\n  $$");
});

test("Backspace right after a link takes one character of its source, not the link", async ({
  page,
}) => {
  await open(page, "see [Textus](https://a.com) end");
  await expect(page.locator(`${editor} a`)).toHaveCount(1);
  // The caret where ProseMirror puts it just after the link.
  await page.evaluate((sel) => {
    const pm = document.querySelector(sel) as HTMLElement & {
      pmViewDesc: {
        node: { firstChild: { child: (i: number) => { nodeSize: number } } };
        domFromPos: (
          pos: number,
          side: number,
        ) => { node: Node; offset: number };
      };
    };
    const paragraph = pm.pmViewDesc.node.firstChild;
    const after = 1 + paragraph.child(0).nodeSize + paragraph.child(1).nodeSize;
    const { node, offset } = pm.pmViewDesc.domFromPos(after, 0);
    pm.focus();
    getSelection()!.collapse(node, offset);
  }, editor);
  await selectionRead(page);
  await page.keyboard.press("Backspace");
  await expect(page.locator(editor)).toContainText(
    "[Textus](https://a.com end",
  );
});

test("--- and Enter make a rule with the caret on the one line below it", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.type("above", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("---", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("below", { delay: 20 });
  expect(await sourceOf(page)).toBe("above\n\n---\n\nbelow");
});
