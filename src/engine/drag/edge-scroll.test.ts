import { afterEach, describe, expect, it, vi } from "vitest";
import { edgeScroll, edgeStep } from "./edge-scroll";

describe("edgeStep", () => {
  it("leaves a pointer well inside the scroller alone", () => {
    expect(edgeStep(300, 100, 700)).toBe(0);
  });
  it("scrolls down near and past the bottom, faster the further", () => {
    const near = edgeStep(690, 100, 700);
    const past = edgeStep(760, 100, 700);
    expect(near).toBeGreaterThan(0);
    expect(past).toBeGreaterThan(near);
  });
  it("scrolls up near and past the top as fast as down", () => {
    expect(edgeStep(110, 100, 700)).toBe(-edgeStep(690, 100, 700));
    expect(edgeStep(40, 100, 700)).toBeLessThan(edgeStep(110, 100, 700));
  });
  it("never goes faster than its cap", () => {
    expect(edgeStep(5000, 100, 700)).toBe(40);
    expect(edgeStep(-5000, 100, 700)).toBe(-40);
  });
});

describe("edgeScroll", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Runs the scroll with the pointer past the bottom for `ms`, frames
   *  every `every` ms; `native` is what the web view adds each frame. */
  function scrolled(every: number, ms: number, topUp = false, native = 0) {
    const el = {
      scrollTop: 0,
      getBoundingClientRect: () => ({ top: 100, bottom: 700 }) as DOMRect,
    } as HTMLElement;
    let queued: ((now: number) => void) | null = null;
    vi.stubGlobal("requestAnimationFrame", (run: (now: number) => void) => {
      queued = run;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const edge = edgeScroll(
      () => el,
      () => {},
      { topUp },
    );
    edge.at(5000);
    for (let now = every; now <= ms; now += every) {
      el.scrollTop += native;
      const run = queued!;
      queued = null;
      run(now);
    }
    return el.scrollTop;
  }

  it("goes as far in a second at 120 Hz as at 60 Hz", () => {
    const at60 = scrolled(1000 / 60, 1000);
    expect(at60).toBeGreaterThan(2000);
    expect(Math.abs(scrolled(1000 / 120, 1000) - at60)).toBeLessThanOrEqual(40);
  });

  it("counts what the web view scrolled by itself, with topUp", () => {
    expect(scrolled(1000 / 60, 1000, true, 25)).toBeCloseTo(
      scrolled(1000 / 60, 1000),
      -2,
    );
    expect(scrolled(1000 / 60, 1000, false, 25)).toBeGreaterThan(
      scrolled(1000 / 60, 1000) + 1000,
    );
  });
});
