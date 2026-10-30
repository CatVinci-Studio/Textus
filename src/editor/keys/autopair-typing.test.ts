// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { closeViews, openView } from "../../document-view/editor-view-kit";

// Brackets, quotes and Markdown links typed by hand: what closes itself,
// what the caret steps over, and what is saved.

afterEach(closeViews);

/** The text under a link mark. */
function linked(doc: import("@milkdown/kit/prose/model").Node): string {
  let text = "";
  doc.descendants((node) => {
    if (node.marks.some((m) => m.type.name === "link")) text += node.text;
  });
  return text;
}

const open = (markdown = "", settings = {}) =>
  openView(markdown, { enableCompletion: false, ...settings });

it("brackets and quotes close themselves, and the typed closer steps over", async () => {
  const t = await open();
  t.type("(");
  expect(t.caretLine()).toBe("(|)");
  t.type('x) [a] {b} "q" don\'t （【c】）');
  expect(t.caretLine()).toBe('(x) [a] {b} "q" don\'t （【c】）|');
  // Backspace right after an opener takes its partner too.
  t.type(" 「");
  t.press("Backspace");
  expect(t.caretLine()).toBe('(x) [a] {b} "q" don\'t （【c】） |');
  expect(t.markdown()).toBe('(x) \\[a] {b} "q" don\'t （【c】）');
});

it("an opener typed over a selection wraps it", async () => {
  const t = await open();
  t.type("see word");
  t.caretAt("word", 0, 4);
  t.type("《");
  expect(t.markdown()).toBe("see 《word》");
});

it("with the setting off, brackets stay as typed", async () => {
  const t = await open("", { autoCloseBrackets: false });
  t.type('("[{（');
  expect(t.caretLine()).toBe('("[{（|');
});

it("a typed [text](url) still becomes a link", async () => {
  const t = await open();
  t.type("[Textus](https://textus.catvinci.com) on");
  expect(t.markdown()).toBe("[Textus](https://textus.catvinci.com) on");
  expect(linked(t.view.state.doc)).toBe("Textus");
});

// The ")" is already there: the address typed, the caret moves on without
// typing it - by Enter, or to anywhere else on the line.
for (const leave of ["Enter", "start of the line", "end of the line"])
  it(`[text](url with its ")" put in becomes a link on leaving it: ${leave}`, async () => {
    const t = await open();
    t.type("See [Textus](https://textus.catvinci.com");
    expect(linked(t.view.state.doc)).toBe("");
    if (leave === "Enter") t.press("Enter");
    else if (leave === "start of the line") t.caretAt("See");
    else t.select(t.view.state.doc.firstChild!.nodeSize - 1);
    expect(linked(t.view.state.doc)).toBe("Textus");
    expect(t.markdown()).toBe("See [Textus](https://textus.catvinci.com)");
  });

it("_italic_ becomes italic, saved with underscores; snake_case stays", async () => {
  const t = await open();
  t.type("an _italic_ word and snake_case");
  const spans: string[] = [];
  t.view.state.doc.descendants((node) => {
    if (node.type.name === "md_span") spans.push(node.textContent);
  });
  expect(spans).toEqual(["italic"]);
  expect(t.markdown()).toBe("an _italic_ word and snake_case");
});

it("Tab in a table moves to the end of the next cell, and Shift+Enter breaks the line in a cell", async () => {
  const t = await open("| a | b |\n| --- | --- |\n| one | two |\n");
  t.caretAt("one", 3);
  t.press("Tab");
  expect(t.caretLine()).toBe("two|");
  t.type("!");
  t.press("Shift+Tab");
  expect(t.caretLine()).toBe("one|");
  t.press("Shift+Enter");
  t.type("more");
  expect(t.markdown()).toMatch(/\| one<br>more \| two! +\|/);
});
