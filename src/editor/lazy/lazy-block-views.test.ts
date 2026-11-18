// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, Plugin, TextSelection } from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  type NodeViewConstructor,
} from "@milkdown/kit/prose/view";
import {
  LazyBlocksDrawer,
  drawAllBlocks,
  drawAround,
  plan,
} from "./lazy-blocks-drawer";
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

/** A widget before each of the first `count` blocks, as a drawn formula
 *  or diagram stands beside its source. */
const widgetsBefore = (count: number) =>
  new Plugin({
    props: {
      decorations: (state) => {
        const widgets: Decoration[] = [];
        state.doc.forEach((_block, offset, index) => {
          if (index < count)
            widgets.push(
              Decoration.widget(offset, () => document.createElement("div")),
            );
        });
        return DecorationSet.create(state.doc, widgets);
      },
    },
  });

/** `count` blocks of 100 characters, every tenth a code block; 2,000 is
 *  past the threshold. */
function open(count: number, drawer = false, widgets = 0) {
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
        widgetsBefore(widgets),
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
    // Two thousand blocks drawn and let go: slow in jsdom on a busy machine.
  }, 20_000);
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

  it("releases drawn blocks four screens away, keeping the caret's", () => {
    const view = open(2000);
    layOut(view);
    const next = plan(view, view.dom.parentElement!)!;
    // 2,500 px is four screens below the screen's bottom.
    expect(next.release).toHaveLength(41 - 25);
    expect(next.release[0]).toBe(startOf(view, 25));
  });

  it("draws nothing while all within a screen is drawn, then two screens' worth at once", () => {
    const view = open(2000);
    view.dispatch(
      view.state.tr.setMeta(lazyBlocksKey, {
        release: [12, 13].map((i) => startOf(view, i)),
      }),
    );
    layOut(view);
    // 1,200 px down: more than a screen below the 500 px screen.
    expect(plan(view, view.dom.parentElement!)?.draw ?? []).toEqual([]);
    view.dispatch(
      view.state.tr.setMeta(lazyBlocksKey, {
        release: [8, 13].map((i) => startOf(view, i)),
      }),
    );
    expect(plan(view, view.dom.parentElement!)!.draw).toEqual(
      [8, 12, 13].map((i) => startOf(view, i)),
    );
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

describe("blocks among widgets", () => {
  it("finds a placeholder's block past many widgets above it", () => {
    const view = open(2000, false, 20);
    view.dispatch(
      view.state.tr.setMeta(lazyBlocksKey, {
        release: [startOf(view, 25), startOf(view, 26)],
      }),
    );
    // Every child 100 px tall; the screen over children 40 to 45, where the
    // two placeholders are, twenty widgets on.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this === view.dom.parentElement)
          return { top: 4000, bottom: 4500, height: 500 } as DOMRect;
        const i = Array.prototype.indexOf.call(view.dom.children, this);
        return {
          top: i * 100,
          bottom: i * 100 + 100,
          height: 100,
          width: 100,
        } as DOMRect;
      },
    );
    expect(view.dom.children[45].className).toBe("lazy-block");
    expect(plan(view, view.dom.parentElement!)!.draw).toEqual([
      startOf(view, 25),
      startOf(view, 26),
    ]);
  });
});

describe("a jump or an export reaching blocks out of sight", () => {
  it("draws the block a jump goes to and those around it", () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    const view = open(2000, true);
    drawAround(view, startOf(view, 1500) + 3);
    expect(view.dom.children[1500].nodeName).toBe("P");
    expect(view.dom.children[1486].nodeName).toBe("P");
    expect(view.dom.children[1514].nodeName).toBe("P");
    expect(view.dom.children[1520].className).toBe("lazy-block");
  });

  it("draws every block for an export, until the user scrolls again", () => {
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
      frame = f;
      return 1;
    });
    const view = open(2000, true);
    drawAllBlocks(view.dom);
    expect(placeholders(view)).toBe(0);
    // A frame on, nothing is released while the export copies the page.
    // Every block far below a 500 px screen.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        return (
          this === view.dom.parentElement
            ? { top: 0, bottom: 500, height: 500 }
            : { top: 99_999, bottom: 99_999, height: 0 }
        ) as DOMRect;
      },
    );
    view.dispatch(view.state.tr);
    (frame as FrameRequestCallback | null)?.(0);
    expect(placeholders(view)).toBe(0);
    view.dom.parentElement!.dispatchEvent(new Event("wheel"));
    (frame as FrameRequestCallback | null)?.(0);
    expect(placeholders(view)).toBeGreaterThan(1500);
    // Two thousand blocks drawn and let go: slow in jsdom on a busy machine.
  }, 20_000);
});
