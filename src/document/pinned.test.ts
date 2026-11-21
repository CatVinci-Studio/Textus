import { describe, expect, it } from "vitest";
import { pinnedFirst, placeAmongPinned } from "./pinned";

describe("pinned tabs", () => {
  it("come first in their row, each part in its order", () => {
    const pinned = new Set(["c", "e"]);
    expect(
      pinnedFirst(["a", "b", "c", "d", "e"], (id) => pinned.has(id)),
    ).toEqual(["c", "e", "a", "b", "d"]);
  });

  it("are dragged among themselves, the others after them", () => {
    // Two pinned: a pinned one stays in 0..1, another lands at 2 or later.
    expect(placeAmongPinned(4, true, 2)).toBe(1);
    expect(placeAmongPinned(0, true, 2)).toBe(0);
    expect(placeAmongPinned(0, false, 2)).toBe(2);
    expect(placeAmongPinned(3, false, 2)).toBe(3);
    expect(placeAmongPinned(5, false, 0)).toBe(5);
  });
});
