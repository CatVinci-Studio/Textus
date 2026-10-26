// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { redo, undo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTestEditor } from "../../document-view/editor-test-harness";
import {
  LINK_SOURCE,
  arrowPastSourceEdge,
  caretInSource,
  linkSyntaxRanges,
  revealedLinkHref,
  visibleTextBetween,
} from "./link-reveal";
import { readSourceBlocks, writePreservingSource } from "./source-preserving";

// An undo scrolls the caret into view, measuring a Range jsdom can't.
beforeAll(() => {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

/** `markdown` in the full editor, focused, as a click into it leaves it. */
async function open(markdown: string, { focus = true } = {}) {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  const opened = view.state.doc;
  if (focus) {
    view.dom.tabIndex = 0;
    view.focus();
  }
  return {
    view,
    opened,
    /** What the serializer writes for the document now. */
    markdown: () =>
      editor.action((ctx) => ctx.get(serializerCtx)(view.state.doc)),
    /** What a save writes for it. */
    saved: () =>
      editor.action((ctx) => {
        const source = readSourceBlocks(ctx, markdown, opened)!;
        return writePreservingSource(ctx, source, view.state.doc);
      }),
  };
}

/** Where `needle` starts in the document's text, plus `offset`. */
function at(doc: ProseNode, needle: string, offset = 0): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    const index = node.isText ? node.text!.indexOf(needle) : -1;
    if (index >= 0) found = pos + index + offset;
    return true;
  });
  if (found < 0) throw new Error(`no "${needle}" in the document`);
  return found;
}

function caretAt(view: EditorView, pos: number) {
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
  );
}

/** The caret's textblock as text, "|" at the caret. */
function shown(view: EditorView): string {
  const { $from, from } = view.state.selection;
  const start = $from.start(1);
  const end = $from.end(1);
  const { doc } = view.state;
  return `${doc.textBetween(start, from)}|${doc.textBetween(from, end)}`;
}

function typeText(view: EditorView, text: string) {
  const { from, to } = view.state.selection;
  view.dispatch(view.state.tr.insertText(text, from, to));
}

const sources = (view: EditorView) => {
  const found: string[] = [];
  view.state.doc.descendants((node) => {
    if (node.type.name === LINK_SOURCE) found.push(node.textContent);
  });
  return found;
};

describe("caretInSource", () => {
  it.each([
    ["foo", "[foo](https://x.org)", 1, 2],
    ["a b", "[a **b**](u)", 2, 3],
    ["a b", "[a **b**](u)", 3, 6],
    ["a*b", "[a\\*b](u)", 2, 4],
    ["https://x.org", "<https://x.org>", 3, 4],
    ["https://x.org", "https://x.org", 3, 3],
  ])("puts the caret %#: %s in %s", (visible, source, offset, expected) => {
    expect(caretInSource(visible, source, offset)).toBe(expected);
  });
});

describe("linkSyntaxRanges", () => {
  it("quiets the brackets and everything after the text", () => {
    expect(linkSyntaxRanges("[a [b] c](u 't')")).toEqual([
      [0, 1],
      [8, 16],
    ]);
    expect(linkSyntaxRanges("[a\\]b][ref]")).toEqual([
      [0, 1],
      [5, 11],
    ]);
  });

  it("quiets an autolink's angle brackets, and nothing of a bare URL", () => {
    expect(linkSyntaxRanges("<https://x.org>")).toEqual([
      [0, 1],
      [14, 15],
    ]);
    expect(linkSyntaxRanges("https://x.org")).toEqual([]);
  });
});

describe("a link under the caret shows its Markdown", () => {
  it.each([
    ["a link", "see [foo](https://x.org) end\n", "fo", "[fo|o](https://x.org)"],
    [
      "a link with a title",
      'see [foo](https://x.org "The title") end\n',
      "f",
      '[f|oo](https://x.org "The title")',
    ],
    [
      "a title in single quotes",
      "see [foo](<a b.md> 'T') end\n",
      "fo",
      "[fo|o](<a b.md> 'T')",
    ],
    [
      "a full reference",
      "see [foo][ref] end\n\n[ref]: https://x.org\n",
      "fo",
      "[fo|o][ref]",
    ],
    [
      "a collapsed reference",
      "see [foo][] end\n\n[foo]: https://x.org\n",
      "fo",
      "[fo|o][]",
    ],
    [
      "a shortcut reference",
      "see [foo] end\n\n[foo]: https://x.org\n",
      "fo",
      "[fo|o]",
    ],
    ["an autolink", "see <https://x.org> end\n", "https", "<https|://x.org>"],
    ["a bare URL", "see https://x.org end\n", "https", "https|://x.org"],
    ["a bare www address", "see www.x.org end\n", "www", "www|.x.org"],
    ["bold inside a link", "see [a **b** c](u) end\n", "b", "[a **b|** c](u)"],
    ["code inside a link", "see [`a`](u) end\n", "a", "[`a|`](u)"],
  ])("%s", async (_kind, markdown, before, expected) => {
    const { view } = await open(markdown);
    caretAt(view, at(view.state.doc, before, before.length));
    expect(sources(view)).toEqual([expected.replace("|", "")]);
    expect(shown(view)).toBe(`see ${expected} end`);
  });

  it("an empty link, shown as its URL, puts the caret in the URL", async () => {
    const { view } = await open("see [](https://x.org) end\n");
    caretAt(view, at(view.state.doc, "https", 2));
    expect(shown(view)).toBe("see [](ht|tps://x.org) end");
  });

  it("at either end of the link, the caret stays outside its source", async () => {
    const { view } = await open("see [foo](u) end\n");
    caretAt(view, at(view.state.doc, "foo"));
    expect(shown(view)).toBe("see |[foo](u) end");
    caretAt(view, at(view.state.doc, " end"));
    expect(shown(view)).toBe("see [foo](u)| end");
  });

  it("a link in a bold span shows without the span's own delimiters", async () => {
    const { view } = await open("see **[foo](u)** end\n");
    caretAt(view, at(view.state.doc, "foo", 1));
    expect(sources(view)).toEqual(["[foo](u)"]);
  });

  it("in a heading and a table cell too", async () => {
    const { view } = await open(
      "# A [head](u)\n\n| a |\n| - |\n| [cell](v) |\n",
    );
    caretAt(view, at(view.state.doc, "head", 1));
    expect(sources(view)).toEqual(["[head](u)"]);
    caretAt(view, at(view.state.doc, "cell", 1));
    expect(sources(view)).toEqual(["[cell](v)"]);
  });

  it("not for a link just typed or pasted, the caret at its end", async () => {
    const { view } = await open("see\n");
    const end = view.state.doc.firstChild!.nodeSize - 1;
    const link = view.state.schema.marks.link.create({ href: "u" });
    caretAt(view, end);
    view.dispatch(
      view.state.tr.insert(end, view.state.schema.text("foo", [link])),
    );
    expect(sources(view)).toEqual([]);
    // Moved back onto it, it shows.
    caretAt(view, end + 1);
    expect(sources(view)).toEqual(["[foo](u)"]);
  });

  it("not while the editor doesn't have the focus", async () => {
    const { view } = await open("see [foo](u) end\n", { focus: false });
    caretAt(view, at(view.state.doc, "foo", 1));
    expect(sources(view)).toEqual([]);
  });

  it("not for a selection, which a shown link keeps while it touches it", async () => {
    const { view } = await open("see [foo](u) end\n");
    const { doc } = view.state;
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(doc, at(doc, "foo"), at(doc, "foo", 2)),
      ),
    );
    expect(sources(view)).toEqual([]);
    caretAt(view, at(view.state.doc, "foo", 1));
    const start = view.state.selection.from;
    // Shift+Right across the rest of the source and on out of it.
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, start, start + 12),
      ),
    );
    expect(sources(view)).toEqual(["[foo](u)"]);
  });
});

describe("a link the caret leaves", () => {
  it("is the link it was, and the document is as opened", async () => {
    const { view, opened, saved } = await open(
      "see [a **b** c](https://x.org 'T') and <https://y.org> end\n",
    );
    caretAt(view, at(view.state.doc, "b", 1));
    caretAt(view, at(view.state.doc, "y.org", 1));
    caretAt(view, at(view.state.doc, " end", 2));
    expect(sources(view)).toEqual([]);
    expect(view.state.doc.eq(opened)).toBe(true);
    expect(saved()).toBe(
      "see [a **b** c](https://x.org 'T') and <https://y.org> end\n",
    );
  });

  it("takes an edited URL and text, and is saved as typed", async () => {
    const markdown = "Intro, _as written_.\n\nsee [foo](https://x.org) end\n";
    const { view, saved } = await open(markdown);
    caretAt(view, at(view.state.doc, "foo", 1));
    caretAt(view, at(view.state.doc, "x.org"));
    typeText(view, "new.");
    caretAt(view, at(view.state.doc, "foo", 3));
    typeText(view, " bar");
    caretAt(view, at(view.state.doc, " end", 2));
    const link = view.state.doc.lastChild!.child(1);
    expect(link.text).toBe("foo bar");
    expect(link.marks[0].attrs.href).toBe("https://new.x.org");
    expect(saved()).toBe(
      "Intro, _as written_.\n\nsee [foo bar](https://new.x.org) end\n",
    );
  });

  it("keeps a title in single quotes as typed, and saves a bare URL as an autolink", async () => {
    const markdown = "a [bc](u 'T') c https://x.org d\n";
    const { view, saved } = await open(markdown);
    caretAt(view, at(view.state.doc, "bc", 1));
    typeText(view, "b");
    caretAt(view, at(view.state.doc, "x.org", 1));
    typeText(view, "y");
    caretAt(view, at(view.state.doc, " d", 2));
    expect(saved()).toBe("a [bbc](u 'T') c <https://xy.org> d\n");
  });

  it("is plain text once it is no link", async () => {
    const { view, markdown } = await open("see [foo](u) end\n");
    caretAt(view, at(view.state.doc, "foo", 1));
    // Backspace over the opening bracket.
    const from = view.state.selection.from;
    view.dispatch(view.state.tr.delete(from - 2, from - 1));
    caretAt(view, at(view.state.doc, " end", 2));
    expect(sources(view)).toEqual([]);
    expect(view.state.doc.textContent).toBe("see foo](u) end");
    expect(view.state.doc.firstChild!.child(0).marks).toEqual([]);
    expect(markdown()).toBe("see foo]\\(u) end\n");
  });

  it("reads a reference against the document's definitions", async () => {
    const markdown =
      "see [foo][a] end\n\n[a]: https://a.org\n[b]: https://b.org\n";
    const { view, saved } = await open(markdown);
    caretAt(view, at(view.state.doc, "foo", 1));
    const ref = at(view.state.doc, "][a]", 2);
    view.dispatch(view.state.tr.insertText("b", ref, ref + 1));
    caretAt(view, at(view.state.doc, " end", 2));
    const link = view.state.doc.firstChild!.child(1);
    expect(link.marks[0].attrs.href).toBe("https://b.org");
    expect(saved()).toBe(markdown.replace("[foo][a]", "[foo][b]"));
  });

  it("goes when all of its source is deleted", async () => {
    const { view } = await open("see [foo](u) end\n");
    caretAt(view, at(view.state.doc, "foo", 1));
    const { $from } = view.state.selection;
    view.dispatch(view.state.tr.delete($from.start(), $from.end()));
    expect(sources(view)).toEqual([]);
    expect(view.state.doc.textContent).toBe("see  end");
  });

  it("keeps spaces typed at its ends as text", async () => {
    const { view } = await open("[foo](u) end\n");
    caretAt(view, at(view.state.doc, "foo", 1));
    const { $from } = view.state.selection;
    view.dispatch(view.state.tr.insertText("  ", $from.start()));
    caretAt(view, at(view.state.doc, " end", 2));
    expect(sources(view)).toEqual([]);
    const para = view.state.doc.firstChild!;
    expect(para.child(0).text).toBe("  ");
    expect(para.child(1).marks[0].attrs.href).toBe("u");
  });
});

describe("saving while a link is shown", () => {
  it("writes the file as it was", async () => {
    const markdown = "Para _one_.\n\nsee [foo](https://x.org 'T') end\n";
    const { view, saved } = await open(markdown);
    caretAt(view, at(view.state.doc, "foo", 1));
    expect(sources(view)).toHaveLength(1);
    expect(saved()).toBe(markdown);
  });

  it("writes an edited source as typed", async () => {
    const markdown = "Para _one_.\n\nsee [foo](https://x.org) end\n";
    const { view, saved } = await open(markdown);
    caretAt(view, at(view.state.doc, "foo", 1));
    caretAt(view, at(view.state.doc, "x.org"));
    typeText(view, "www.");
    expect(saved()).toBe("Para _one_.\n\nsee [foo](https://www.x.org) end\n");
  });
});

describe("undo", () => {
  it("takes back an edit of a link in one step", async () => {
    const markdown = "see [foo](https://x.org) end\n";
    const { view, markdown: written } = await open(markdown);
    caretAt(view, at(view.state.doc, "foo", 1));
    caretAt(view, at(view.state.doc, "x.org"));
    typeText(view, "new.");
    caretAt(view, at(view.state.doc, " end", 2));
    expect(written()).toBe("see [foo](https://new.x.org) end\n");
    undo(view.state, view.dispatch);
    expect(written()).toBe(markdown);
    // The caret moved on, the redo is still there.
    caretAt(view, 1);
    redo(view.state, view.dispatch);
    expect(written()).toBe("see [foo](https://new.x.org) end\n");
  });

  it("of an edit before a look at a link, takes back that edit", async () => {
    const { view, opened } = await open("one\n\nsee [foo](u) end\n");
    caretAt(view, at(view.state.doc, "one", 3));
    typeText(view, " two");
    caretAt(view, at(view.state.doc, "foo", 1));
    expect(sources(view)).toHaveLength(1);
    undo(view.state, view.dispatch);
    expect(sources(view)).toEqual([]);
    expect(view.state.doc.eq(opened)).toBe(true);
  });
});

describe("Left and Right at the edges of a link's source", () => {
  it("step one character past the edge, never onto its other side", async () => {
    const { view } = await open("see [foo](u) end\n");
    caretAt(view, at(view.state.doc, "foo", 1));
    const { $from } = view.state.selection;
    const start = $from.before();
    const end = $from.after();
    const step = (pos: number, dir: 1 | -1) => {
      caretAt(view, pos);
      return arrowPastSourceEdge(view.state, dir);
    };
    // Before "[" and just inside it alike: past "[", or back past " ".
    expect(step(start, 1)).toBe(start + 2);
    expect(step(start + 1, 1)).toBe(start + 2);
    expect(step(start + 1, -1)).toBe(start - 1);
    // After ")" and just inside it alike: before ")", or on past " ".
    expect(step(end, -1)).toBe(end - 2);
    expect(step(end - 1, 1)).toBe(end + 1);
    // Inside, the browser steps.
    expect(step(start + 3, 1)).toBeNull();
  });
});

describe("Enter in a link's source", () => {
  const enter = (view: EditorView) =>
    view.someProp("handleKeyDown", (f) =>
      f(view, new KeyboardEvent("keydown", { key: "Enter" })),
    );

  it("at its end breaks the line after the link", async () => {
    const { view, markdown } = await open("see [foo](u)end\n");
    caretAt(view, at(view.state.doc, "foo", 1));
    caretAt(view, view.state.selection.$from.end());
    enter(view);
    expect(sources(view)).toEqual([]);
    expect(markdown()).toBe("see [foo](u)\n\nend\n");
  });

  it("inside it splits the source as text", async () => {
    const { view, markdown } = await open("see [foo](u) end\n");
    caretAt(view, at(view.state.doc, "foo", 1));
    enter(view);
    expect(sources(view)).toEqual([]);
    expect(markdown()).toBe("see \\[f\n\noo]\\(u) end\n");
  });
});

describe("visibleTextBetween", () => {
  it("reads a shown link as its text", async () => {
    const { view } = await open("see [foo](u) end\n");
    const { doc } = view.state;
    const expected = doc.textBetween(0, doc.content.size, " ");
    caretAt(view, at(doc, "foo", 1));
    const now = view.state.doc;
    expect(visibleTextBetween(now, 0, now.content.size, " ")).toBe(expected);
  });
});

describe("revealedLinkHref", () => {
  it("is the URL of the link shown at the element", async () => {
    const { view } = await open("see [foo](https://x.org) end\n");
    caretAt(view, at(view.state.doc, "foo", 1));
    const el = view.dom.querySelector(`[data-type="${LINK_SOURCE}"]`);
    expect(revealedLinkHref(view, el)).toBe("https://x.org");
  });
});
