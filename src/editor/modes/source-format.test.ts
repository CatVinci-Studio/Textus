// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  insertSourceLink,
  setSourceBlock,
  toggleSourceFence,
  toggleSourceMark,
} from "./source-format";
import { sourceKeys, sourceTab } from "./source-keys";
import { modIsMeta } from "../../platform/os";

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

  it("clears every run the selection touches, leaving code and snake_case", () => {
    const view = viewOf("a **b [c** ~~d~~ ==e==] *f* `**g**` snake_case_name");
    expect(toggleSourceMark(view, "clear")).toBe(true);
    expect(shown(view)).toBe("a b [c d e] *f* `**g**` snake_case_name");
  });

  it("clears nested runs, and nothing with nothing to clear", () => {
    const view = viewOf("[***x***]");
    toggleSourceMark(view, "clear");
    expect(view.state.doc.toString()).toBe("x");
    expect(toggleSourceMark(viewOf("[2 * 3 * 4]"), "clear")).toBe(false);
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

  it("leaves a caret at the line's start after the new prefix, so typing goes into the heading", () => {
    for (const doc of ["|", "|text", "  |text"]) {
      const view = viewOf(doc);
      setSourceBlock(view, "h3");
      view.dispatch(view.state.replaceSelection("你"));
      expect(view.state.doc.toString()).toBe(
        doc.includes("text")
          ? `${doc.startsWith(" ") ? "  " : ""}### 你text`
          : "### 你",
      );
    }
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

describe("the rendered editor's keys in source mode", () => {
  // jsdom has no layout: moving a line scrolls the caret into view, which
  // measures a range's rects.
  beforeAll(() => {
    Range.prototype.getClientRects = () =>
      ({
        length: 0,
        item: () => null,
        [Symbol.iterator]: function* () {},
      }) as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  });
  const mac = modIsMeta();
  /** `combo` pressed in `doc`: what the source then reads. */
  function press(doc: string, init: KeyboardEventInit) {
    const view = viewOf(doc);
    view.dispatch({ effects: StateEffect.appendConfig.of(sourceKeys) });
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
    return view.state.doc.toString();
  }
  const mod = mac ? { metaKey: true } : { ctrlKey: true };

  it("writes the Format menu's marks and a link around the selection", () => {
    expect(
      press("[word]", { ...mod, shiftKey: true, key: "H", code: "KeyH" }),
    ).toBe("==word==");
    expect(
      press("[word]", {
        ctrlKey: true,
        shiftKey: true,
        key: "~",
        code: "Backquote",
      }),
    ).toBe("~~word~~");
    expect(
      press("[word]", { ctrlKey: true, key: "`", code: "Backquote" }),
    ).toBe("`word`");
    expect(press("[word]", { ...mod, key: "k", code: "KeyK" })).toBe(
      "[word]()",
    );
  });

  it("sets blocks by the block keys, a Mac's Alt-changed character read by its key", () => {
    expect(
      press("wo|rd", {
        ...mod,
        altKey: true,
        key: mac ? "™" : "2",
        code: "Digit2",
      }),
    ).toBe("## word");
    expect(
      press("wo|rd", {
        ...mod,
        altKey: true,
        key: mac ? "ª" : "8",
        code: "Digit8",
      }),
    ).toBe("- word");
    expect(
      press("wo|rd", {
        ...mod,
        altKey: true,
        key: mac ? "ç" : "c",
        code: "KeyC",
      }),
    ).toBe("```\nword\n```");
    expect(
      press("wo|rd", { ...mod, shiftKey: true, key: "B", code: "KeyB" }),
    ).toBe("> word");
  });

  it("moves, indents and leaves lines", () => {
    expect(
      press("a\nb|", { altKey: true, key: "ArrowUp", code: "ArrowUp" }),
    ).toBe("b\na");
    expect(press("- a|", { ...mod, key: "]", code: "BracketRight" })).toMatch(
      /^\s+- a$/,
    );
    expect(press("wo|rd", { ...mod, key: "Enter", code: "Enter" })).toBe(
      "word\n",
    );
  });
});

describe("toggleSourceFence", () => {
  const toggled = (doc: string) => {
    const view = viewOf(doc);
    toggleSourceFence(view);
    return view.state.doc.toString();
  };

  it("puts the selected lines in a fence, and takes it off from anywhere inside", () => {
    expect(toggled("a\n[one\ntwo]\nb")).toBe("a\n```\none\ntwo\n```\nb");
    expect(toggled("a\n```js\none\n|two\nthree\n```\nb")).toBe(
      "a\none\ntwo\nthree\nb",
    );
    expect(toggled("```\n|one\n```")).toBe("one");
  });

  it("fences a line between two blocks, leaving both as they are", () => {
    expect(toggled("```js\na\n```\n|between\n```py\nb\n```")).toBe(
      "```js\na\n```\n```\nbetween\n```\n```py\nb\n```",
    );
  });

  it("reads a longer fence, and one of tildes, as Markdown does", () => {
    // The inner ``` is text of the ```` block.
    expect(toggled("````\n```\n|x\n```\n````")).toBe("```\nx\n```");
    expect(toggled("~~~\n|x\n~~~")).toBe("x");
  });
});

describe("Tab in source mode", () => {
  it("takes a list's line in a level wherever the caret is in it", () => {
    const view = viewOf("- one\n- tw|o");
    sourceTab(view);
    // By the view's indent unit (source mode's is a tab).
    expect(view.state.doc.toString()).toMatch(/^- one\n\s+- two$/);
    const numbered = viewOf("1. a\n2. b|");
    sourceTab(numbered);
    expect(numbered.state.doc.toString()).toMatch(/^1\. a\n\s+2\. b$/);
  });

  it("writes a tab at the caret anywhere else", () => {
    const view = viewOf("a|b");
    sourceTab(view);
    expect(view.state.doc.toString()).toBe("a\tb");
  });
});
