// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { closeViews, openView } from "../../document-view/editor-view-kit";
import { arrowPastLinkEdge, linkHrefAt } from "./link-reveal";

// A link holds its Markdown as text; the caret on it shows that source,
// elsewhere decorations hide its syntax. Nothing about it is a document edit.

// An undo scrolls the caret into view, measuring a Range jsdom can't.
beforeAll(() => {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

afterEach(closeViews);

const open = (markdown: string) =>
  openView(markdown, { enableCompletion: false });

/** What the first link reads as on screen: hidden syntax left out. */
function shown(view: EditorView): string {
  const link = view.dom.querySelector('[data-type="link"]')!.cloneNode(true);
  (link as Element)
    .querySelectorAll(".link-source-hidden")
    .forEach((el) => el.remove());
  return link.textContent ?? "";
}

/** The first link node and where it starts. */
function firstLink(doc: ProseNode): { node: ProseNode; pos: number } {
  let found: { node: ProseNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (node.type.name === "link") found ??= { node, pos };
  });
  return found!;
}

const caret = (view: EditorView, pos: number) =>
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
  );

const MARKDOWN = 'See [the **docs**](https://x.org "T") here.';

describe("a link", () => {
  it("reads as its text while the caret is away, its Markdown while on it", async () => {
    const t = await open(MARKDOWN);
    t.caretAtEnd();
    expect(shown(t.view)).toBe("the docs");
    expect(
      t.view.dom.querySelector('[data-type="link"] strong')?.textContent,
    ).toBe("docs");
    t.caretAt("the");
    expect(shown(t.view)).toBe('[the **docs**](https://x.org "T")');
    t.caretAtEnd();
    expect(shown(t.view)).toBe("the docs");
  });

  it("is never edited by being looked at", async () => {
    const t = await open(MARKDOWN);
    const opened = t.view.state.doc;
    t.caretAt("docs");
    t.caretAtEnd();
    expect(t.view.state.doc).toBe(opened);
    expect(t.markdown()).toBe(MARKDOWN);
  });

  it("shows an empty label's URL", async () => {
    const t = await open("A [](https://x.org/a) b");
    t.caretAtEnd();
    expect(shown(t.view)).toBe("https://x.org/a");
    expect(t.markdown()).toBe("A [](https://x.org/a) b");
  });

  it("an autolink hides its angle brackets, a bare URL nothing", async () => {
    const t = await open("A <https://a.org> and https://b.org end");
    t.caretAtEnd();
    const links = [...t.view.dom.querySelectorAll('[data-type="link"]')];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://a.org",
      "https://b.org",
    ]);
    expect(shown(t.view)).toBe("https://a.org");
  });
});

describe("undo and redo", () => {
  it("an edit of a revealed link undoes and redoes in one step each", async () => {
    const t = await open(MARKDOWN);
    t.caretAt("x.org", 1);
    t.type("y");
    expect(t.markdown()).toBe('See [the **docs**](https://xy.org "T") here.');
    t.caretAtEnd();
    t.press("Mod+z");
    expect(t.markdown()).toBe(MARKDOWN);
    // Back on the link, the redo is still there.
    t.caretAt("docs");
    t.press("Mod+Shift+z");
    expect(t.markdown()).toBe('See [the **docs**](https://xy.org "T") here.');
  });

  it("an edit before a look at a link undoes to the document as opened", async () => {
    const t = await open(MARKDOWN);
    t.caretAtEnd();
    t.type("!");
    t.caretAt("docs");
    t.caretAtEnd();
    t.press("Mod+z");
    expect(t.markdown()).toBe(MARKDOWN);
    t.caretAt("docs");
    t.press("Mod+Shift+z");
    expect(t.markdown()).toBe(`${MARKDOWN}!`);
  });
});

describe("typing in a link", () => {
  it("at its ends goes outside it", async () => {
    const t = await open("A [b](u) c");
    const { pos, node } = firstLink(t.view.state.doc);
    caret(t.view, pos + node.nodeSize - 1);
    t.type("x");
    caret(t.view, pos + 1);
    t.type("y");
    const link = firstLink(t.view.state.doc).node;
    expect(link.textContent).toBe("[b](u)");
    expect(t.view.state.doc.textContent).toBe("A y[b](u)x c");
    expect(t.markdown()).toBe("A y[b](u)x c");
  });

  it("an IME composition goes into the link's text and stays there", async () => {
    const t = await open("A [link](u) c");
    t.caretAt("link", 2);
    const { from } = t.view.state.selection;
    // What a composition's updates and commit dispatch.
    t.view.dispatch(
      t.view.state.tr.insertText("ni", from).setMeta("composition", 1),
    );
    t.view.dispatch(
      t.view.state.tr
        .insertText("你", from, from + 2)
        .setMeta("composition", 1),
    );
    expect(firstLink(t.view.state.doc).node.textContent).toBe("[li你nk](u)");
    t.caretAtEnd();
    expect(t.markdown()).toBe("A [li你nk](u) c");
  });

  it("edited into no link, reads as what it is once the caret leaves", async () => {
    const t = await open("A [b](u) c");
    t.caretAt("](u)", 1);
    t.press("Delete");
    expect(firstLink(t.view.state.doc).node.textContent).toBe("[b]u)");
    t.caretAtEnd();
    expect(firstLink(t.view.state.doc)).toBeNull();
    expect(t.view.state.doc.textContent).toBe("A [b]u) c");
  });

  it("Enter inside it splits its source as text", async () => {
    const t = await open("A [bc](u) d");
    t.caretAt("bc", 1);
    t.press("Enter");
    expect(t.view.state.doc.childCount).toBe(2);
    expect(firstLink(t.view.state.doc)).toBeNull();
  });
});

describe("Left and Right at a link's edges", () => {
  it("step one character past the edge, never onto its other side", async () => {
    const t = await open("ab [c](u) de");
    const { pos, node } = firstLink(t.view.state.doc);
    const end = pos + node.nodeSize;
    const step = (at: number, dir: 1 | -1) => {
      caret(t.view, at);
      return arrowPastLinkEdge(t.view.state, dir);
    };
    expect(step(pos, 1)).toBe(pos + 2);
    expect(step(pos + 1, 1)).toBe(pos + 2);
    expect(step(end, 1)).toBe(end + 1);
    expect(step(end - 1, 1)).toBe(end + 1);
    expect(step(end, -1)).toBe(end - 2);
    expect(step(pos, -1)).toBe(pos - 1);
    expect(step(pos + 3, 1)).toBeNull();
    // The key does it, and the document stays as it was.
    caret(t.view, pos);
    t.press("ArrowRight");
    expect(t.view.state.selection.from).toBe(pos + 2);
    expect(t.markdown()).toBe("ab [c](u) de");
  });
});

describe("two editors on one file", () => {
  it("each shows and saves its links on its own", async () => {
    const a = await open(MARKDOWN);
    const b = await open(MARKDOWN);
    a.caretAt("docs");
    b.caretAtEnd();
    expect(shown(a.view)).toBe('[the **docs**](https://x.org "T")');
    expect(shown(b.view)).toBe("the docs");
    a.caretAt("x.org", 1);
    a.type("y");
    expect(b.markdown()).toBe(MARKDOWN);
    expect(a.markdown()).toBe('See [the **docs**](https://xy.org "T") here.');
  });
});

describe("linkHrefAt", () => {
  it("reads a link's URL, a reference's from its definition", async () => {
    const t = await open("[a][r] and [b](https://b.org)\n\n[r]: https://r.org");
    const links = t.view.dom.querySelectorAll('[data-type="link"]');
    expect(linkHrefAt(t.view, links[0])).toBe("https://r.org");
    expect(linkHrefAt(t.view, links[1])).toBe("https://b.org");
    expect(linkHrefAt(t.view, t.view.dom)).toBeNull();
  });
});
