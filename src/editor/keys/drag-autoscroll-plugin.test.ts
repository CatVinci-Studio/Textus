import { describe, expect, it } from "vitest";
import { edgeStep } from "./drag-autoscroll-plugin";

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
