// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  blockAt,
  holdBlock,
  holdBy,
  holdText,
  holdStill,
  keepWhile,
  pageIsTheHands,
  textAt,
} from "./scroll-hold";

describe("what is on screen held still", () => {
  const scroller = (scrollTop: number) => {
    const el = document.createElement("div");
    Object.defineProperties(el, {
      scrollHeight: { value: 2000 },
      clientHeight: { value: 500 },
    });
    let top = scrollTop;
    Object.defineProperty(el, "scrollTop", {
      get: () => top,
      set: (v: number) => (top = v),
    });
    return el;
  };
  const moved = (by: number) => {
    const el = document.createElement("p");
    document.body.append(el);
    el.getBoundingClientRect = () => ({ top: 100 + by }) as DOMRect;
    return { el, top: 100 };
  };

  it("scrolls by what moved, but not while the page is pulled past an end", () => {
    const resting = scroller(300);
    holdStill(resting, moved(20));
    expect(resting.scrollTop).toBe(320);
    // The page's own stretch moves its content, not its scroll position.
    const stretched = scroller(300);
    stretched.setAttribute("data-stretched", "");
    for (const pulled of [scroller(-30), scroller(1540), stretched]) {
      const was = pulled.scrollTop;
      holdStill(pulled, moved(20));
      expect(pulled.scrollTop).toBe(was);
    }
  });
});

describe("a box above the screen that changes size", () => {
  it("scrolls the page by its change, so what is shown holds still", () => {
    expect(holdBy(0, 236, -300, 0)).toBe(236);
    expect(holdBy(320, 92, -500, 40)).toBe(-228);
  });

  it("leaves the page alone when it is on screen, new or the same", () => {
    expect(holdBy(0, 236, 120, 0)).toBe(0);
    expect(holdBy(undefined, 236, -300, 0)).toBe(0);
    expect(holdBy(236, 236.2, -300, 0)).toBe(0);
  });
});

describe("the page is the hand's", () => {
  const box = (scrollTop: number) => {
    const el = document.createElement("div");
    Object.defineProperties(el, {
      scrollHeight: { value: 2000 },
      clientHeight: { value: 500 },
      scrollTop: { value: scrollTop },
    });
    return el;
  };

  it("while pulled past either end or stretched by the page", () => {
    expect(pageIsTheHands(box(-1))).toBe(true);
    expect(pageIsTheHands(box(1501))).toBe(true);
    expect(pageIsTheHands(box(1500.4))).toBe(false);
    expect(pageIsTheHands(box(0))).toBe(false);
    const stretched = box(300);
    stretched.setAttribute("data-stretched", "");
    expect(pageIsTheHands(stretched)).toBe(true);
  });
});

describe("holding a scroll position", () => {
  const scroller = (scrollTop: number) => {
    const el = document.createElement("div");
    Object.defineProperties(el, {
      scrollHeight: { value: 2000 },
      clientHeight: { value: 500 },
    });
    let top = scrollTop;
    Object.defineProperty(el, "scrollTop", {
      get: () => top,
      set: (v: number) => (top = v),
    });
    return el;
  };

  it("rounds a held block's move to whole pixels, ignoring less than half", () => {
    const el = document.createElement("div");
    Object.defineProperties(el, {
      scrollHeight: { value: 2000 },
      clientHeight: { value: 500 },
    });
    let top = 300;
    Object.defineProperty(el, "scrollTop", {
      get: () => top,
      set: (v: number) => (top = v),
    });
    const p = document.createElement("p");
    document.body.append(p);
    p.getBoundingClientRect = () => ({ top: 112.6 }) as DOMRect;
    holdStill(el, { el: p, top: 100 });
    expect(el.scrollTop).toBe(313);
    p.getBoundingClientRect = () => ({ top: 100.4 }) as DOMRect;
    holdStill(el, { el: p, top: 100 });
    expect(el.scrollTop).toBe(313);
  });

  it("keeps a block's share of its height at the line, unrounded", () => {
    const el = scroller(100);
    const block = document.createElement("p");
    let rect = { top: 50, height: 100, bottom: 150 };
    block.getBoundingClientRect = () => rect as DOMRect;
    // The line a quarter down the block; the block grows to 200 and moves
    // to 60: that share of it is now at 109, 34.5 past the line.
    holdBlock(
      el,
      block,
      74.5,
      () => (rect = { top: 60, height: 200, bottom: 260 }),
    );
    expect(el.scrollTop).toBeCloseTo(100 + 60 + 0.245 * 200 - 74.5);
  });

  it("holds the character at a point, at the end of its text too, and none off text", () => {
    const within = document.body.appendChild(document.createElement("p"));
    const text = within.appendChild(document.createTextNode("abc"));
    let top = 40;
    const rects = vi
      .spyOn(Range.prototype, "getClientRects")
      .mockImplementation(() => [{ top }] as unknown as DOMRectList);
    const hitAt = (node: Node, offset: number) =>
      (document.caretRangeFromPoint = () =>
        ({ startContainer: node, startOffset: offset }) as Range);
    hitAt(text, 3);
    const held = textAt(within, 0, 0)!;
    expect(held.range.startOffset).toBe(2);
    expect(held.top).toBe(40);
    // The text rewraps: its character's line put back where it was.
    const el = scroller(100);
    holdText(el, held, () => (top = 75));
    expect(el.scrollTop).toBe(135);
    // As a block held still: whole pixels, and not while pulled past an end.
    holdText(el, held, () => (top = 40.3));
    expect(el.scrollTop).toBe(135);
    const pulled = scroller(-30);
    holdText(pulled, held, () => (top = 75));
    expect(pulled.scrollTop).toBe(-30);
    hitAt(within, 0);
    expect(textAt(within, 0, 0)).toBeNull();
    rects.mockRestore();
    Reflect.deleteProperty(document, "caretRangeFromPoint");
    within.remove();
  });

  it("finds the block at a line, else the first below it", () => {
    const blocks = document.createElement("div");
    for (const bottom of [100, 200]) {
      const b = document.createElement("p");
      b.getBoundingClientRect = () => ({ bottom }) as DOMRect;
      blocks.append(b);
    }
    expect(blockAt(blocks, 150)).toBe(blocks.children[1]);
    expect(blockAt(blocks, 250)).toBeNull();
  });

  it("puts the page back after a focus scrolls it, now and on the next frame", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) =>
      frames.push(f),
    );
    const el = scroller(400);
    keepWhile(el, () => (el.scrollTop = 900));
    expect(el.scrollTop).toBe(400);
    el.scrollTop = 1200;
    frames.forEach((f) => f(0));
    expect(el.scrollTop).toBe(400);
    vi.unstubAllGlobals();
  });
});
