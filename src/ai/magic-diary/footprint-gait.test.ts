import { describe, it, expect } from "vitest";
import { orbitPoint, orbitLength } from "./footprint-gait";

describe("the single perimeter route", () => {
  it("returns to the same position and direction after a complete lap", () => {
    const start = orbitPoint(1200, 800, 0);
    expect(orbitPoint(1200, 800, orbitLength(1200, 800))).toEqual(start);
  });
  it("walks continuously through all four edges and rounded corners", () => {
    const points = Array.from({ length: 400 }, (_, i) =>
      orbitPoint(1200, 800, i * 10),
    );
    for (let i = 1; i < points.length; i++) {
      expect(
        Math.hypot(
          points[i].x - points[i - 1].x,
          points[i].y - points[i - 1].y,
        ),
      ).toBeLessThanOrEqual(10.01);
    }
    expect(points.some((p) => p.heading === 180)).toBe(true);
    expect(points.some((p) => p.heading === 270)).toBe(true);
    expect(
      points.every((p) => p.y >= 90 && p.y <= 760 && p.x >= 38 && p.x <= 1162),
    ).toBe(true);
  });
});

// A long journey must take more steps, never stretch the steps to fit a timer.
describe("journey steps", () => {
  it.each([44, 220, 2200])(
    "keeps the same spacing across a %ipx journey",
    async (length) => {
      const { stepToward } = await import("./footprint-gait");
      let point = { x: 0, y: 0, heading: 0 };
      const target = { x: length, y: 0, heading: 0 };
      for (let i = 0; i < length / 22; i++) {
        const next = stepToward(point, target, 22);
        expect(next.moved).toBeCloseTo(22);
        expect(next.point.x - point.x).toBeCloseTo(22);
        point = next.point;
      }
      expect(point.x).toBe(length);
    },
  );
  it("does not overshoot a final partial stride", async () => {
    const { stepToward } = await import("./footprint-gait");
    const next = stepToward(
      { x: 0, y: 0, heading: 0 },
      { x: 3, y: 4, heading: 0 },
      22,
    );
    expect(next.moved).toBe(5);
    expect(next.arrived).toBe(true);
    expect(next.point.x).toBe(3);
    expect(next.point.y).toBe(4);
  });
});
