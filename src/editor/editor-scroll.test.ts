// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { Schema } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";

const glideScroll = vi.fn();
vi.mock("../engine/motion/motion", () => ({ glideScroll }));
const { scrollOptions } = await import("./editor-scroll");

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: {},
  },
});

/** A page 500 tall at the window's top, its caret drawn at `caretTop`;
 *  `asked` edits so far asked to show the caret. */
function page(caretTop: number, asked: number) {
  const scroller = document.createElement("div");
  scroller.className = "editor-scroll";
  Object.defineProperty(scroller, "clientHeight", { value: 500 });
  scroller.getBoundingClientRect = () =>
    ({ top: 0, bottom: 500, left: 0, right: 800 }) as DOMRect;
  const dom = document.createElement("div");
  scroller.append(dom);
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("words")]),
  ]);
  const state = Object.assign(
    EditorState.create({ doc, selection: TextSelection.create(doc, 2) }),
    { scrollToSelection: asked },
  );
  const view = {
    dom,
    state,
    coordsAtPos: () => ({
      top: caretTop,
      bottom: caretTop + 20,
      left: 10,
      right: 11,
    }),
    domAtPos: () => ({ node: dom, offset: 0 }),
  } as unknown as EditorView;
  return { view, handle: scrollOptions(dom).handleScrollToSelection };
}

describe("the caret brought into sight", () => {
  it("glides the page to a caret below it, once per edit that asks", () => {
    glideScroll.mockClear();
    const { view, handle } = page(560, 1);
    expect(handle(view)).toBe(true);
    expect(glideScroll).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      85,
      "--dur-fast",
    );
    // The focus coming back asks nothing new: the page stays.
    expect(handle(view)).toBe(true);
    expect(glideScroll).toHaveBeenCalledTimes(1);
  });

  it("glides up to a caret above it, and leaves one in sight alone", () => {
    glideScroll.mockClear();
    const above = page(-40, 1);
    above.handle(above.view);
    expect(glideScroll).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      -45,
      "--dur-fast",
    );
    const inSight = page(200, 1);
    inSight.handle(inSight.view);
    expect(glideScroll).toHaveBeenCalledTimes(1);
  });
});
