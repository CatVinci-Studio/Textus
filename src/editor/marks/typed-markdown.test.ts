// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { closeViews, openView } from "../../document-view/editor-view-kit";

// Markdown typed by hand, character by character: what the input rules
// make of it, as the app saves it.

afterEach(closeViews);

const open = (markdown = "", settings = {}) =>
  openView(markdown, { enableCompletion: false, ...settings });

/** The text of every node of `type` in the document. */
function textsOf(doc: ProseNode, type: string): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === type) out.push(node.textContent);
  });
  return out;
}

/** Each span's delimiter and text: "**x" for bold x. */
function spans(doc: ProseNode): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "md_span")
      out.push(
        `${String(node.attrs.delim).repeat(node.attrs.rung)}${node.textContent}`,
      );
  });
  return out;
}

/** Each list item's task state: null for a plain item. */
function tasks(doc: ProseNode): (boolean | null)[] {
  const out: (boolean | null)[] = [];
  doc.descendants((node) => {
    if (node.type.name === "list_item") out.push(node.attrs.checked);
  });
  return out;
}

it("typing a closing ** or ~~ by hand closes the span once, and text after *** goes into the bold-italic span", async () => {
  const t = await open();
  t.type("A **bold** and *it* end. ~~s~~ done");
  t.press("Enter");
  t.type("A ***both*** end");
  expect(t.markdown()).toBe(
    "A **bold** and *it* end. ~~s~~ done\n\nA ***both*** end",
  );
});

it("deleting the text after bold or italic leaves the caret after the closing mark", async () => {
  const t = await open();
  t.type("前**3**位。");
  t.press("Enter");
  t.type("前*3*位。");
  // The caret after 位, which is then erased: first the bold line's, then,
  // the first gone, the italic line's.
  for (let line = 0; line < 2; line++) {
    t.caretAt("位", 1);
    t.press("Backspace");
    t.type("x");
  }
  expect(t.markdown()).toBe("前**3**x。\n\n前*3*x。");
});

it("with closing marks off, ** stays as typed and **x** still turns bold", async () => {
  const t = await open("", { autoCloseMarks: false });
  t.type("**");
  expect(t.view.state.doc.textContent).toBe("**");
  expect(spans(t.view.state.doc)).toEqual([]);
  t.type("x**");
  expect(spans(t.view.state.doc)).toEqual(["**x"]);
  t.type(" and ~~s~~");
  expect(t.markdown()).toBe("**x** and ~~s~~");
});

it("typed dollar amounts stay text; a typed formula still forms", async () => {
  const t = await open();
  const prices = [
    "It costs $5 a month, or $50 a year.",
    "Price $4) and $19 ok.",
    "The plan costs $5.",
  ];
  for (const line of prices) {
    t.type(line);
    t.press("Enter");
  }
  t.type("Area $x^2$ and $2 \\times 3$ here.");
  const doc = t.view.state.doc;
  expect(doc.childCount).toBe(4);
  for (let i = 0; i < prices.length; i++) {
    expect(doc.child(i).textContent).toBe(prices[i]);
    expect(textsOf(doc.child(i), "math_inline")).toEqual([]);
  }
  expect(textsOf(doc.child(3), "math_inline")).toHaveLength(2);
});

it("ASCII - [] and -[] make tasks too; the space after - [ ] is eaten", async () => {
  const t = await open();
  t.type("- [ ] milk");
  for (const spelling of ["- []", "-[]", "-[x]"]) {
    t.press("Enter");
    t.press("Enter");
    t.type(spelling + "eggs");
  }
  expect(tasks(t.view.state.doc)).toEqual([false, false, false, true]);
  expect(textsOf(t.view.state.doc, "paragraph")).toEqual([
    "milk",
    "eggs",
    "eggs",
    "eggs",
  ]);
});

it("Enter on an empty nested task lifts it a level as a task, not a bullet", async () => {
  const t = await open("- [ ] one\n  - [ ] two\n    - [ ] three");
  t.caretAt("three", 5);
  t.press("Enter");
  t.press("Enter");
  t.type("four");
  expect(t.markdown()).toContain("  - [ ] two\n    - [ ] three\n  - [ ] four");
});
