import { describe, expect, it } from "vitest";
import { chooseLandmark } from "./map-landmarks";

describe("optional landmark visits", () => {
  const places = [
    { id: 0, point: { x: 100, y: 150, heading: 0 } },
    { id: 1, point: { x: 1100, y: 150, heading: 0 } },
    { id: 2, point: { x: 100, y: 650, heading: 0 } },
    { id: 3, point: { x: 1100, y: 650, heading: 0 } },
  ];
  it("randomly chooses among the nearby side trips without crossing the writing column", () => {
    expect(
      chooseLandmark(places, { x: 1150, y: 400, heading: 90 }, 0)?.id,
    ).toBe(1);
    expect(
      chooseLandmark(places, { x: 1150, y: 400, heading: 90 }, 0.99)?.id,
    ).toBe(3);
  });
  it("does not visit a building if no map is laid out", () => {
    expect(chooseLandmark([], { x: 100, y: 100, heading: 0 }, 0)).toBeNull();
  });
});
