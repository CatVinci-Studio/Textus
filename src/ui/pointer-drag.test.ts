// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  dropIndex,
  makeRoom,
  roomFor,
  trackDrag,
  type Slot,
} from "./pointer-drag";

const slots: Slot[] = ["a", "b", "c", "d"].map((id, i) => ({
  id,
  center: 20 + i * 40,
  size: 36,
}));

it("drops where the dragged item's center has passed the others", () => {
  expect(dropIndex(slots, "a", 0)).toBe(0);
  expect(dropIndex(slots, "a", 45)).toBe(1);
  expect(dropIndex(slots, "a", 200)).toBe(3);
  expect(dropIndex(slots, "d", -90)).toBe(1);
});

it("moves each passed item one slot the other way", () => {
  const room = makeRoom(slots, "a", 85, 4);
  expect(Object.fromEntries(room)).toEqual({ b: -40, c: -40 });
  expect(Object.fromEntries(makeRoom(slots, "d", -50, 4))).toEqual({ c: 40 });
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
