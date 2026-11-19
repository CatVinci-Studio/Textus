import { describe, expect, it } from "vitest";
import { handlePlace, nearestGap, withRoom } from "./block-handle-place";

describe("a block's handle", () => {
  it("stands in the margin left of the text, and of a list item's marker", () => {
    const block = { x: 100, y: 40, w: 500, h: 60 };
    const handle = { w: 42, h: 24 };
    expect(handlePlace(block, 28, handle)).toEqual({ x: 54, y: 42 });
    expect(handlePlace(block, 28, handle, 14).x).toBe(40);
  });

  it("centres on the first line, never above the block on a short one", () => {
    const block = { x: 0, y: 10, w: 100, h: 20 };
    expect(handlePlace(block, 16, { w: 40, h: 24 }).y).toBe(10);
  });
});

describe("where a pulled block lands", () => {
  const gaps = [
    { pos: 0, y: 0, left: 0 },
    { pos: 10, y: 50, left: 0 },
    // The end of a nested list and of the list around it, at one height.
    { pos: 20, y: 100, left: 40 },
    { pos: 21, y: 100, left: 0 },
  ];

  it("is the nearest gap by height", () => {
    expect(nearestGap(gaps, 200, 20)?.pos).toBe(0);
    expect(nearestGap(gaps, 200, 30)?.pos).toBe(10);
  });

  it("at one height, is the innermost the pointer is right of", () => {
    expect(nearestGap(gaps, 60, 100)?.pos).toBe(20);
    expect(nearestGap(gaps, 10, 100)?.pos).toBe(21);
  });

  it("with the room open, is the place the pointer sees, past it moved down by the block", () => {
    const tall = 40;
    const places = [0, 1, 2, 3].map((pos) => ({ pos, y: pos * 24, left: 0 }));
    // Open at 1: 2 shows at 48 + 40, the room's middle at 24 + 20.
    const at = (y: number) => nearestGap(withRoom(places, 1, tall), 10, y)!.pos;
    expect(at(44)).toBe(1);
    expect(at(88)).toBe(2);
    expect(at(60)).toBe(1);
    expect(nearestGap(withRoom(places, null, tall), 10, 48)!.pos).toBe(2);
  });
});
