// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { closeViews, openView } from "../../document-view/editor-view-kit";

// Typing Markdown by hand and the keys around blocks: what each keystroke
// leaves in the document, as the app would save it.

afterEach(closeViews);

/** No ghost text: a suggestion landing mid-flow would move the caret. */
const open = (markdown = "") => openView(markdown, { enableCompletion: false });

it("* and *** start a list and a rule, as - and --- do; seven #s are no heading", async () => {
  const t = await open();
  t.type("* item");
  t.press("Enter");
  t.press("Enter");
  t.type("***");
  t.press("Enter");
  t.type("####### seven");
  expect(t.markdown()).toBe("* item\n\n---\n\n####### seven");
});

it("Shift+Enter in a heading starts a new line below it, in a code block a new line in it", async () => {
  const t = await open("# Title\n\n```\ncode\n```");
  t.caretAt("Title", 5);
  t.press("Shift+Enter");
  t.type("body");
  t.caretAt("code", 4);
  t.press("Shift+Enter");
  t.type("more");
  expect(t.markdown()).toBe("# Title\n\nbody\n\n```\ncode\nmore\n```");
});

it("text typed after a wikilink or inside inline code at Enter stays out of the node", async () => {
  const t = await open();
  t.type("See [[Note]] here");
  t.press("Enter");
  t.type("A `split` b");
  t.caretAt("split", 2);
  t.press("Enter");
  expect(t.markdown()).toBe("See [[Note]] here\n\nA `sp`\n\n`lit` b");
});

it("Tab and Shift+Tab indent and outdent the selected lines of a code block, and are the editor's", async () => {
  const t = await open("Before\n\n```\none\ntwo\nthree\n```");
  // From the start of "one" to the start of "three", which stays as it is.
  t.caretAt("one", 0, "one\ntwo\n".length);
  expect(t.press("Tab")).toBe(true);
  expect(t.markdown()).toBe("Before\n\n```\n  one\n  two\nthree\n```");
  t.caretAt("one", -2);
  expect(t.press("Shift+Tab")).toBe(true);
  expect(t.markdown()).toBe("Before\n\n```\none\n  two\nthree\n```");
});

it("Backspace at a heading's start makes it text; at a callout's first line it keeps the callout, then makes a plain quote", async () => {
  const t = await open("### Title\n\n> [!NOTE]\n> Body text\n");
  t.caretAt("Title");
  t.press("Backspace");
  expect(t.markdown()).toMatch(/^Title\n/);
  t.caretAt("Body text");
  t.press("Backspace");
  expect(t.markdown()).toBe("Title\n\n> [!NOTE]\n> Body text");
  t.press("Backspace");
  expect(t.markdown()).toBe("Title\n\n> Body text");
});

it("HTML, a <br> and a footnote reference typed out are saved as typed", async () => {
  const t = await open();
  t.type("a <kbd>K</kbd> b<br>c[^1] d");
  expect(t.markdown()).toBe("a <kbd>K</kbd> b<br>c[^1] d");
});

it("Enter before a space starts the new line without it", async () => {
  const t = await open("one two\n");
  t.caretAt("one two", 3);
  t.press("Enter");
  expect(t.markdown()).toBe("one\n\ntwo");
});

it("Mod+B and Mod+I pressed again at the end of what was typed end it, and the text goes on", async () => {
  const t = await open();
  t.press("Mod+b");
  t.type("bold");
  t.press("Mod+b");
  t.type(" and ");
  t.press("Mod+i");
  t.type("it");
  t.press("Mod+i");
  t.type(" after");
  expect(t.markdown()).toBe("**bold** and *it* after");
  // Inside the word it still takes the bold off.
  t.caretAt("bold", 2);
  t.press("Mod+b");
  expect(t.markdown()).toBe("bold and *it* after");
});

it("Mod+B and Mod+I on a selection keep it selected, so they add up and come off again", async () => {
  const t = await open();
  t.type("hello world");
  t.caretAt("world", 0, 5);
  t.press("Mod+b");
  expect(t.selected()).toBe("world");
  t.press("Mod+i");
  expect(t.selected()).toBe("world");
  expect(t.markdown()).toBe("hello ***world***");
  t.press("Mod+b");
  expect(t.selected()).toBe("world");
  t.press("Mod+i");
  expect(t.selected()).toBe("world");
  expect(t.markdown()).toBe("hello world");
});

it("~~ and == stay as typed until their closing pair makes a strikethrough or a highlight", async () => {
  const t = await open();
  t.type("~~");
  // Two tildes, not an empty strikethrough written as four.
  expect(t.view.state.doc.textContent).toBe("~~");
  const marks: string[] = [];
  t.view.state.doc.descendants((node) => {
    marks.push(...node.marks.map((mark) => mark.type.name));
  });
  expect(marks).toEqual([]);
  t.type("gone~~ and ==kept== ok");
  expect(t.markdown()).toBe("~~gone~~ and ==kept== ok");
});

it("Backspace at a code block's start and Delete before it move the caret, leaving the block whole", async () => {
  const t = await open("Before\n\n```js\none\ntwo\n```");
  t.caretAt("one");
  t.press("Backspace");
  t.type("!");
  t.press("Delete");
  t.type("x");
  expect(t.markdown()).toBe("Before!\n\n```js\nxone\ntwo\n```");
});

it("Delete before a table goes into its first cell", async () => {
  const t = await open("Before\n\n| a | b |\n| - | - |\n| c | d |");
  t.caretAt("Before", 6);
  t.press("Delete");
  t.type("x");
  expect(t.markdown()).toBe("Before\n\n| xa | b |\n| -- | - |\n| c  | d |");
});

it("Delete before a quote joins its first line", async () => {
  const t = await open("Above\n\n> one\n>\n> two");
  t.caretAt("Above", 5);
  t.press("Delete");
  expect(t.markdown()).toBe("Aboveone\n\n> two");
});

it("Enter in a code block in a list adds a line, and an indented blank line keeps the block", async () => {
  const t = await open("- item\n\n  ```py\n  def f():\n      x = 1\n  ```");
  t.caretAt("x = 1", 5);
  t.press("Enter");
  t.press("Enter");
  t.type("y = 2");
  expect(t.markdown()).toBe(
    "- item\n\n  ```py\n  def f():\n      x = 1\n\n      y = 2\n  ```",
  );
});

it("typing over a selection that ends in a code block keeps the code block", async () => {
  const t = await open("Before\n\n```js\none\ntwo\n```");
  // From the start of "Before" to the end of "one".
  t.select(t.caretAt("Before"), t.caretAt("one", 3));
  t.type("Z");
  expect(t.markdown()).toBe("Z\n\n```js\n\ntwo\n```");
});

it("Delete before a callout puts the caret at its text, keeping the callout", async () => {
  const t = await open("Above\n\n> [!NOTE]\n> body");
  t.caretAt("Above", 5);
  t.press("Delete");
  t.type("x");
  expect(t.markdown()).toBe("Above\n\n> [!NOTE]\n> xbody");
});

it("``` and $$ typed in a list item start a code block and a maths block in it", async () => {
  const code = await open();
  code.type("- item");
  code.press("Enter");
  code.type("```js");
  code.press("Enter");
  code.type("x");
  expect(code.markdown()).toBe("* item\n* ```js\n  x\n  ```");

  const maths = await open();
  maths.type("- item");
  maths.press("Enter");
  maths.type("$$");
  maths.press("Enter");
  maths.type("y");
  expect(maths.markdown()).toBe("* item\n* $$\n  y\n  $$");
});

it("--- and Enter make a rule with the caret on the one line below it", async () => {
  const t = await open();
  t.type("above");
  t.press("Enter");
  t.type("---");
  t.press("Enter");
  t.type("below");
  expect(t.markdown()).toBe("above\n\n---\n\nbelow");
});

it("Alt+Up and Alt+Down move a list item, caret along", async () => {
  const t = await open();
  t.type("- one");
  t.press("Enter");
  t.type("two");
  t.press("Alt+ArrowUp");
  t.type("!");
  expect(t.markdown()).toBe("* two!\n* one");
  t.press("Alt+ArrowDown");
  expect(t.markdown()).toBe("* one\n* two!");
});
