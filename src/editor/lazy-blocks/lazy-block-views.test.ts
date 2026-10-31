// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { EditorView, type NodeViewConstructor } from "@milkdown/kit/prose/view";
import { LazyBlocksDrawer, plan } from "./lazy-blocks-drawer";
import { lazyBlockNodeViews, rememberHeight } from "./lazy-block-views";
import { createLazyBlocksPlugin, lazyBlocksKey } from "./lazy-blocks-state";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "text*",
      group: "block",
      toDOM: () => ["p", 0],
    },
    code_block: {
      content: "text*",
      group: "block",
      code: true,
      toDOM: () => ["pre", ["code", 0]],
    },
    text: {},
  },
});

/** The code block's own view, as the app's language picker is. */
const codeView: NodeViewConstructor = () => {
  const dom = document.createElement("div");
  dom.className = "own-code-view";
  const contentDOM = document.createElement("code");
  dom.append(contentDOM);
  return { dom, contentDOM };
};

const line = (i: number) => `${i}`.padEnd(100, ".");

const views: EditorView[] = [];
afterEach(() => {
  views.splice(0).forEach((v) => v.destroy());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** `count` blocks of 100 characters, every tenth a code block; 2,000 is
 *  past the threshold. */
function open(count: number, drawer = false) {
  const doc = schema.node(
    "doc",
    null,
    Array.from({ length: count }, (_, i) =>
      schema.node(
        i % 10 === 5 ? "code_block" : "paragraph",
        null,
        schema.text(line(i)),
      ),
    ),
  );
  const place = document.createElement("div");
  document.body.append(place);
  const view = new EditorView(place, {
    state: EditorState.create({
      doc,
      plugins: [
        createLazyBlocksPlugin(
          drawer ? { view: (v) => new LazyBlocksDrawer(v) } : {},
        ),
      ],
    }),
    nodeViews: lazyBlockNodeViews(schema, { code_block: codeView }),
  });
  views.push(view);
  return view;
}

const placeholders = (view: EditorView) =>
  view.dom.querySelectorAll(":scope > .lazy-block").length;

function startOf(view: EditorView, index: number) {
  let at = 0;
  for (let i = 0; i < index; i++) at += view.state.doc.child(i).nodeSize;
  return at;
}

describe("a long document's blocks drawn lazily", () => {
  it("draws a short document as it always has, the code blocks in their own view", () => {
    const view = open(100);
    expect(placeholders(view)).toBe(0);
    expect(view.dom.children[0].nodeName).toBe("P");
    expect(view.dom.children[5].className).toBe("own-code-view");
  });

  it("draws the blocks near the caret and leaves placeholders for the rest", () => {
    const view = open(2000);
    expect(placeholders(view)).toBe(2000 - 41);
    expect(view.dom.children[5].className).toBe("own-code-view");
    expect(view.dom.children[100].className).toBe("lazy-block");
    // The document itself is whole.
    expect(view.state.doc.childCount).toBe(2000);
  });

  it("draws a placeholder's block once asked to, in its own view", () => {
    const view = open(2000);
    view.dispatch(
      view.state.tr.setMeta(lazyBlocksKey, {
        draw: [startOf(view, 1005), startOf(view, 1006)],
      }),
    );
    expect(view.dom.children[1005].className).toBe("own-code-view");
    expect(view.dom.children[1006].textContent).toBe(line(1006));
  });

  it("puts a released block back as a placeholder of its measured height", () => {
    const view = open(2000);
    rememberHeight(view, view.state.doc.child(30), 123);
    view.dispatch(
      view.state.tr.setMeta(lazyBlocksKey, { release: [startOf(view, 30)] }),
    );
    const placeholder = view.dom.children[30] as HTMLElement;
    expect(placeholder.className).toBe("lazy-block");
    expect(placeholder.style.height).toBe("123px");
  });

  it("draws the block the caret moves to and lets the caret sit in it", () => {
    const view = open(2000);
    const at = startOf(view, 1500) + 3;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, at)),
    );
    expect(view.dom.children[1500].nodeName).toBe("P");
    expect(view.domAtPos(at).node.textContent).toBe(line(1500));
  });

  it("draws every block again when the document shrinks below the threshold", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    const view = open(2000, true);
    view.dispatch(
      view.state.tr.delete(startOf(view, 500), startOf(view, 2000)),
    );
    await Promise.resolve();
    expect(placeholders(view)).toBe(0);
    expect(view.dom.children[400].textContent).toBe(line(400));
  });

  it("makes placeholders of a document grown past the threshold", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    const view = open(1000, true);
    expect(placeholders(view)).toBe(0);
    view.dispatch(
      view.state.tr.insert(view.state.doc.content.size, view.state.doc.content),
    );
    await Promise.resolve();
    expect(placeholders(view)).toBeGreaterThan(1500);
  });
});

describe("what is on screen decides what is drawn", () => {
  /** Every block 100 px tall, one under another; a 500 px screen at the
   *  top of the document. */
  function layOut(view: EditorView) {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this === view.dom.parentElement)
          return { top: 0, bottom: 500, height: 500 } as DOMRect;
        const i = Array.prototype.indexOf.call(view.dom.children, this);
        return { top: i * 100, bottom: i * 100 + 100, height: 100 } as DOMRect;
      },
    );
  }

  it("asks for nothing more while the screen and a screen below are drawn", () => {
    const view = open(2000);
    layOut(view);
    const next = plan(view, view.dom.parentElement!);
    expect(next?.draw).toEqual([]);
  });

  it("releases drawn blocks three screens away, keeping the caret's", () => {
    const view = open(2000);
    layOut(view);
    const next = plan(view, view.dom.parentElement!)!;
    // 2,000 px is three screens below the screen's bottom.
    expect(next.release).toHaveLength(41 - 20);
    expect(next.release[0]).toBe(startOf(view, 20));
  });

  it("asks for nothing while the editor has no layout (a tab in the back)", () => {
    const view = open(2000);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 0,
      height: 0,
    } as DOMRect);
    expect(plan(view, view.dom.parentElement!)).toBeNull();
  });

  it("asks for the placeholders scrolled into view", () => {
    const view = open(2000);
    view.dispatch(
      view.state.tr.setMeta(lazyBlocksKey, {
        release: [startOf(view, 3), startOf(view, 4)],
      }),
    );
    layOut(view);
    expect(plan(view, view.dom.parentElement!)!.draw).toEqual([
      startOf(view, 3),
      startOf(view, 4),
    ]);
  });
});
