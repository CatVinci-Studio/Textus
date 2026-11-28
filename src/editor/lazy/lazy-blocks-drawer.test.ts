// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@milkdown/kit/prose/view";

// While the window's islands move, the column is already at its end width
// and clipped: measuring blocks then would only cost frames. The drawer
// waits for the motion to end, then draws once.
const clock = vi.hoisted(() => ({
  moving: false,
  settled: new Set<() => void>(),
}));
vi.mock("../../engine/frame/clock", () => ({
  frameClock: {
    moving: () => clock.moving,
    onSettled: (cb: () => void) => {
      clock.settled.add(cb);
      return () => clock.settled.delete(cb);
    },
  },
}));

import { LazyBlocksDrawer } from "./lazy-blocks-drawer";

let queued: FrameRequestCallback[] = [];
const frame = () => {
  const due = queued;
  queued = [];
  for (const cb of due) cb(0);
};
let resized: ResizeObserverCallback | null = null;
const resize = (width: number) =>
  resized?.(
    [{ contentRect: { width } } as ResizeObserverEntry],
    {} as ResizeObserver,
  );

function drawer() {
  const scroller = document.createElement("div");
  scroller.className = "editor-scroll";
  const dom = document.createElement("div");
  scroller.append(dom);
  const view = { dom, isDestroyed: false } as unknown as EditorView;
  return { drawer: new LazyBlocksDrawer(view), scroller };
}

let drawn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  clock.moving = false;
  clock.settled.clear();
  queued = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queued.push(cb);
    return queued.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: ResizeObserverCallback) {
        resized = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
  drawn = vi
    .spyOn(LazyBlocksDrawer.prototype, "drawNow")
    .mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the lazy blocks' drawer while the islands move", () => {
  it("waits for the motion to end, then measures once", () => {
    const { drawer: d } = drawer();
    resize(600);
    frame();
    drawn.mockClear();
    clock.moving = true;
    resize(500);
    resize(450);
    frame();
    frame();
    expect(drawn).not.toHaveBeenCalled();
    clock.moving = false;
    for (const cb of clock.settled) cb();
    frame();
    expect(drawn).toHaveBeenCalledTimes(1);
    d.destroy();
    expect(clock.settled.size).toBe(0);
  });

  it("draws as the page scrolls, motion or not", () => {
    const { drawer: d, scroller } = drawer();
    frame();
    drawn.mockClear();
    clock.moving = true;
    scroller.dispatchEvent(new Event("scroll"));
    frame();
    expect(drawn).toHaveBeenCalledTimes(1);
    d.destroy();
  });

  it("asks nothing of a settled clock it owes nothing", () => {
    const { drawer: d } = drawer();
    frame();
    drawn.mockClear();
    for (const cb of clock.settled) cb();
    frame();
    expect(drawn).not.toHaveBeenCalled();
    d.destroy();
  });
});
