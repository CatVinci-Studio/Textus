import { describe, expect, it } from "vitest";
import { listMove } from "./list-keys";

describe("listMove", () => {
  it("steps with the arrows and wraps around", () => {
    expect(listMove("ArrowDown", 2, 3)).toBe(0);
    expect(listMove("ArrowUp", 0, 3)).toBe(2);
  });

  it("starts at an end with nothing highlighted", () => {
    expect(listMove("ArrowDown", -1, 3)).toBe(0);
    expect(listMove("ArrowUp", -1, 3)).toBe(2);
  });

  it("leaves Home and End to a text box", () => {
    expect(listMove("End", 0, 3)).toBe(2);
    expect(listMove("End", 0, 3, false)).toBeNull();
    expect(listMove("ArrowDown", 0, 0)).toBeNull();
  });
});
