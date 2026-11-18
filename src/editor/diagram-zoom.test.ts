import { describe, expect, it } from "vitest";
import { keepInView, nextScale, wheelNotch } from "./diagram-zoom";

describe("nextScale", () => {
  it("zooms in on a wheel up and out on a wheel down, evenly", () => {
    const up = nextScale(1, -100);
    const down = nextScale(1, 100);
    expect(up).toBeGreaterThan(1);
    expect(down).toBeLessThan(1);
    expect(up * down).toBeCloseTo(1);
  });
  it("stays within its bounds", () => {
    expect(nextScale(1, -1e6)).toBe(8);
    expect(nextScale(1, 1e6)).toBe(0.25);
  });
});

describe("keepInView", () => {
  it("leaves a picture where it is while some of it shows", () => {
    expect(keepInView(100, 500, 800)).toBe(100);
    expect(keepInView(-400, 500, 800)).toBe(-400);
  });
  it("keeps a strip of a picture pushed out, and all of a small one", () => {
    expect(keepInView(-5000, 500, 800)).toBe(64 - 500);
    expect(keepInView(5000, 500, 800)).toBe(800 - 64);
    expect(keepInView(5000, 20, 800)).toBe(780);
  });
});

describe("wheelNotch", () => {
  const wheel = (wheelDeltaY: number, deltaX = 0, deltaMode = 0) => ({
    deltaMode,
    deltaX,
    wheelDeltaY,
  });
  it("takes a mouse wheel's notch for zooming", () => {
    expect(wheelNotch(wheel(-120), false)).toBe(true);
    expect(wheelNotch(wheel(240), false)).toBe(true);
    expect(wheelNotch(wheel(0, 0, 1), true)).toBe(true);
  });
  it("takes a trackpad's swipe for moving, momentum included", () => {
    expect(wheelNotch(wheel(-12), false)).toBe(false);
    expect(wheelNotch(wheel(-120, 3), false)).toBe(false);
    expect(wheelNotch(wheel(-120), true)).toBe(false);
  });
});
