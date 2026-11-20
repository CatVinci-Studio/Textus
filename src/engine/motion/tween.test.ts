import { afterEach, describe, expect, it, vi } from "vitest";
import { tween } from "./tween";

describe("tween", () => {
  afterEach(() => vi.unstubAllGlobals());

  function frames() {
    let queued: ((now: number) => void) | null = null;
    vi.stubGlobal("requestAnimationFrame", (run: (now: number) => void) => {
      queued = run;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      queued = null;
    });
    return (now: number) => {
      const run = queued;
      queued = null;
      run?.(now);
      return run !== null;
    };
  }

  it("runs from its first frame to 1 over its span, eased", () => {
    const next = frames();
    const seen: number[] = [];
    tween(
      100,
      (t) => t * t,
      (p) => seen.push(p),
    );
    for (const now of [1000, 1050, 1100, 1150]) next(now);
    expect(seen).toEqual([0, 0.25, 1]);
  });

  it("stops where it is told to", () => {
    const next = frames();
    const seen: number[] = [];
    const stop = tween(
      100,
      (t) => t,
      (p) => seen.push(p),
    );
    next(0);
    stop();
    expect(next(50)).toBe(false);
    expect(seen).toEqual([0]);
  });
});
