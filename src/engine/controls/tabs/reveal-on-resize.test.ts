// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { revealOnResize } from "./reveal-on-resize";

type Entry = { target: Element; contentRect: { width: number } };
let fire: (entries: Entry[]) => void = () => {};
const real = globalThis.ResizeObserver;

afterEach(() => {
  globalThis.ResizeObserver = real;
});

function fakeObserver() {
  globalThis.ResizeObserver = class {
    constructor(cb: (entries: Entry[]) => void) {
      fire = cb;
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
}

describe("revealOnResize", () => {
  it("reveals again when the strip alone narrows, a closed tab gone", () => {
    fakeObserver();
    const bar = document.createElement("div");
    const strip = document.createElement("div");
    const again = vi.fn();
    revealOnResize([bar, strip], again);
    // The first measure: the row may have narrowed since the reveal.
    fire([
      { target: bar, contentRect: { width: 300 } },
      { target: strip, contentRect: { width: 400 } },
    ]);
    expect(again).toHaveBeenCalledTimes(1);
    fire([{ target: strip, contentRect: { width: 260 } }]);
    expect(again).toHaveBeenCalledTimes(2);
    fire([{ target: bar, contentRect: { width: 300 } }]);
    expect(again).toHaveBeenCalledTimes(2);
  });
});
