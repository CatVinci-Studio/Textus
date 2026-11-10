// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { dropTargetAt, type DropGeometry } from "./drop-zones";

// Two islands side by side, each 400 x 600, the window's outer band left
// aside (x from 100, the outer edges far from the points tested).
const geometry: DropGeometry = {
  panes: [
    { rect: new DOMRect(0, 0, 400, 600), tabId: "a" },
    { rect: new DOMRect(400, 0, 400, 600), tabId: "b" },
  ],
  single: null,
  bars: [],
};
const at = (x: number, y: number, held?: ReturnType<typeof dropTargetAt>) =>
  dropTargetAt(x, y, geometry, false, held)?.zone;

describe("dropTargetAt", () => {
  it("an island's outer fifth opens beside it, the rest joins it", () => {
    expect(at(400 + 70, 300)).toBe("left");
    expect(at(400 + 90, 300)).toBe("center");
    expect(at(400 + 200, 130)).toBe("center");
    expect(at(400 + 200, 110)).toBe("top");
    expect(at(400 + 200, 520)).toBe("bottom");
  });

  it("the place aimed at holds a little past its line", () => {
    const left = dropTargetAt(400 + 70, 300, geometry)!;
    expect(at(400 + 90, 300, left)).toBe("left");
    expect(at(400 + 110, 300, left)).toBe("center");
    const middle = dropTargetAt(400 + 200, 300, geometry)!;
    expect(at(400 + 70, 300, middle)).toBe("center");
    expect(at(400 + 60, 300, middle)).toBe("left");
  });

  it("whole islands go to the half they are over", () => {
    expect(dropTargetAt(400 + 150, 300, geometry, true)?.zone).toBe("left");
    expect(dropTargetAt(400 + 250, 300, geometry, true)?.zone).toBe("right");
  });
});
