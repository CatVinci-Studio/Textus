// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  insertSourceLink,
  setSourceBlock,
  toggleSourceMark,
} from "./source-format";

/** A view of `doc`, "|" marking the caret or "[…]" the selection. */
function viewOf(doc: string) {
  const from = doc.search(/[|[]/);
  const text = doc.replace(/[|[\]]/g, "");
  const to = doc.includes("]") ? doc.indexOf("]") - 1 : from;
  return new EditorView({
    state: EditorState.create({
      doc: text,
      selection: EditorSelection.range(from, to),
    }),
  });
}

const shown = (view: EditorView) => {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc.toString();
  return from === to
    ? `${doc.slice(0, from)}|${doc.slice(from)}`
    : `${doc.slice(0, from)}[${doc.slice(from, to)}]${doc.slice(to)}`;
};

describe("toggleSourceMark", () => {
  it("wraps the selection, and takes the marker off again", () => {
    const view = viewOf("a [word] b");
    toggleSourceMark(view, "bold");
    expect(shown(view)).toBe("a **[word]** b");
    toggleSourceMark(view, "bold");
    expect(shown(view)).toBe("a [word] b");
  });

  it("unwraps a selection that holds its markers", () => {
    const view = viewOf("[==hi==]");
    toggleSourceMark(view, "highlight");
    expect(shown(view)).toBe("[hi]");
  });

  it("leaves the caret between the markers with nothing selected", () => {
    const view = viewOf("a |b");
    toggleSourceMark(view, "italic");
    expect(shown(view)).toBe("a *|*b");
  });

  it("doesn't read half of a bold as italic", () => {
    const view = viewOf("**[x]**");
    toggleSourceMark(view, "italic");
    expect(shown(view)).toBe("***[x]***");
  });

  it("wraps the words, not the line break after them", () => {
    const view = viewOf("[word\n]");
    toggleSourceMark(view, "bold");
    expect(view.state.doc.toString()).toBe("**word**\n");
  });

  it("adds italic to a bold selected with its markers", () => {
    const view = viewOf("[**bold**]");
    toggleSourceMark(view, "italic");
    expect(view.state.doc.toString()).toBe("***bold***");
  });

  it("wraps two marked words rather than unwrapping across them", () => {
    const view = viewOf("[**a** and **b**]");
    toggleSourceMark(view, "bold");
    expect(view.state.doc.toString()).toBe("****a** and **b****");
  });

  it("refuses a mark it doesn't write", () => {
    expect(toggleSourceMark(viewOf("|"), "underline")).toBe(false);
  });
});

describe("setSourceBlock", () => {
  it("sets a heading over whatever prefix the line had", () => {
    const view = viewOf("- it|em");
    setSourceBlock(view, "h2");
    expect(view.state.doc.toString()).toBe("## item");
  });

  it("numbers the lines of an ordered list, and takes it off again", () => {
    const view = viewOf("[one\ntwo]");
    setSourceBlock(view, "ordered-list");
    expect(view.state.doc.toString()).toBe("1. one\n2. two");
    setSourceBlock(view, "ordered-list");
    expect(view.state.doc.toString()).toBe("one\ntwo");
  });

  it("leaves the next line and blank lines alone", () => {
    const view = viewOf("[a\n\nb\n]c");
    setSourceBlock(view, "bullet-list");
    expect(view.state.doc.toString()).toBe("- a\n\n- b\nc");
  });

  it("keeps a line's indent", () => {
    const view = viewOf("  * a|");
    setSourceBlock(view, "task-list");
    expect(view.state.doc.toString()).toBe("  - [ ] a");
  });

  it("makes body text of a heading", () => {
    const view = viewOf("### T|");
    setSourceBlock(view, "paragraph");
    expect(view.state.doc.toString()).toBe("T");
  });
});

describe("insertSourceLink", () => {
  it("puts the caret where the address goes", () => {
    const view = viewOf("[site]");
    insertSourceLink(view);
    expect(shown(view)).toBe("[site](|)");
  });
});
