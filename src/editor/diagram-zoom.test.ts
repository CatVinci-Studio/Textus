import { describe, expect, it } from "vitest";
import { nextScale } from "./diagram-zoom";

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
