// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { trackDrag } from "./pointer-drag";
import { passedCount, roomFor, shiftAt } from "./row";

// Four items 36 wide, 4 apart: centres 20, 60, 100, 140.
const centersWithout = (i: number) =>
  [20, 60, 100, 140].filter((_, j) => j !== i);

it("drops where the dragged item's center has passed the others", () => {
  expect(passedCount(centersWithout(0), 20)).toBe(0);
  expect(passedCount(centersWithout(0), 20 + 45)).toBe(1);
  expect(passedCount(centersWithout(0), 20 + 200)).toBe(3);
  expect(passedCount(centersWithout(3), 140 - 90)).toBe(1);
});

it("moves each passed item one slot the other way", () => {
  // The first dragged past two: those two step back.
  const to = passedCount(centersWithout(0), 20 + 85);
  expect([0, 1, 2].map((i) => shiftAt(i, 0, to, 40))).toEqual([-40, -40, 0]);
  // The last dragged back past one: it steps on.
  const back = passedCount(centersWithout(3), 140 - 50);
  expect([0, 1, 2].map((i) => shiftAt(i, 3, back, 40))).toEqual([0, 0, 40]);
});

const pointer = (type: string, x: number, y = 0) =>
  window.dispatchEvent(
    Object.assign(new MouseEvent(type, { clientX: x, clientY: y }), {
      pointerId: 1,
    }),
  );

it("starts only past the threshold, drops on release, not on Esc", () => {
  const end = vi.fn();
  const move = vi.fn();
  trackDrag({ button: 0, clientX: 0, clientY: 0 }, { move, end });
  pointer("pointermove", 2);
  expect(move).not.toHaveBeenCalled();
  pointer("pointermove", 30);
  pointer("pointerup", 30);
  expect(end).toHaveBeenCalledWith(30, 0, true);

  const end2 = vi.fn();
  trackDrag({ button: 0, clientX: 0, clientY: 0 }, { move, end: end2 });
  pointer("pointermove", 30);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(end2).toHaveBeenCalledWith(0, 0, false);
});

it("swallows the click a drag's release sends", () => {
  const clicked = vi.fn();
  document.body.addEventListener("click", clicked);
  trackDrag({ button: 0, clientX: 0, clientY: 0 }, { move() {}, end() {} });
  pointer("pointermove", 30);
  pointer("pointerup", 30);
  document.body.click();
  expect(clicked).not.toHaveBeenCalled();
  document.body.removeEventListener("click", clicked);
});

describe("roomFor", () => {
  it("moves on what lies past the place something arrives at", () => {
    const centers = new Map([
      ["a", 50],
      ["b", 150],
      ["c", 250],
    ]);
    expect([...roomFor(centers, 120, 100)]).toEqual([
      ["a", 0],
      ["b", 100],
      ["c", 100],
    ]);
  });
});
