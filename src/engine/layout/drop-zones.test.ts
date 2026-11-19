// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { dropTargetAt, type DropGeometry } from "./drop-zones";
import {
  askGiveWay,
  givingWayNow,
  panelsGaveWay,
  sidebarGaveWay,
  layoutFits,
  refusal,
  setLayoutFits,
  setSidebarRoom,
  shortGivingWay,
} from "../frame/frame-store";

const phone = vi.hoisted(() => ({ on: false }));
vi.mock("../../platform/phone-layout", () => ({
  isPhoneLayout: () => phone.on,
}));

// Two islands side by side, each 400 x 600, the window's outer band left
// aside (x from 100, the outer edges far from the points tested).
const geometry: DropGeometry = {
  panes: [
    { rect: new DOMRect(0, 0, 400, 600), tabId: "a" },
    { rect: new DOMRect(400, 0, 400, 600), tabId: "b" },
  ],
  bars: [],
};
const at = (x: number, y: number, held?: ReturnType<typeof dropTargetAt>) =>
  dropTargetAt(x, y, geometry, false, held)?.zone;

describe("dropTargetAt", () => {
  it("an island's outer fifth opens beside it, its top or bottom stacks one, the rest joins it", () => {
    expect(at(400 + 75, 300)).toBe("left");
    expect(at(400 + 85, 300)).toBe("center");
    expect(at(400 + 200, 100)).toBe("center");
    expect(at(400 + 200, 80)).toBe("top");
    expect(at(400 + 200, 520)).toBe("bottom");
  });

  it("stacks under one column above the window's foot, under all of them at it", () => {
    const column = dropTargetAt(400 + 200, 520, geometry);
    expect(column).toMatchObject({ zone: "bottom", tabId: "b" });
    expect(column?.whole).toBeUndefined();
    expect(dropTargetAt(400 + 200, 595, geometry)).toMatchObject({
      zone: "bottom",
      whole: true,
    });
  });

  it("the place aimed at holds a little past its line", () => {
    const left = dropTargetAt(400 + 75, 300, geometry)!;
    expect(at(400 + 95, 300, left)).toBe("left");
    expect(at(400 + 105, 300, left)).toBe("center");
    const middle = dropTargetAt(400 + 200, 300, geometry)!;
    expect(at(400 + 70, 300, middle)).toBe("center");
    expect(at(400 + 60, 300, middle)).toBe("left");
  });

  it("whole islands go to the half they are over", () => {
    expect(dropTargetAt(400 + 150, 300, geometry, true)?.zone).toBe("left");
    expect(dropTargetAt(400 + 250, 300, geometry, true)?.zone).toBe("right");
  });

  it("on a phone everything dropped joins the one island, and no split fits", () => {
    phone.on = true;
    try {
      expect(at(400 + 10, 300)).toBe("center");
      expect(at(400 + 200, 595)).toBe("center");
      const split = {
        kind: "split" as const,
        direction: "row" as const,
        children: [
          { kind: "pane" as const, id: "p", tabs: ["a"], front: "a" },
          { kind: "pane" as const, id: "q", tabs: ["b"], front: "b" },
        ],
        sizes: [0.5, 0.5],
      };
      expect(layoutFits(split)).toBe(false);
      expect(layoutFits(split.children[0])).toBe(true);
    } finally {
      phone.on = false;
    }
  });
});

describe("a split into too little room", () => {
  const split = {
    kind: "split" as const,
    direction: "row" as const,
    children: [
      { kind: "pane" as const, id: "p", tabs: ["a"], front: "a" },
      { kind: "pane" as const, id: "q", tabs: ["b"], front: "b" },
    ],
    sizes: [0.5, 0.5],
  };

  it("is made when folding the panels and putting the sidebar aside makes room", () => {
    try {
      // 300 short: the AI's island gives 200, the sidebar 100.
      setLayoutFits(() => ({ short: 300, panels: 200 }));
      setSidebarRoom(100);
      expect(layoutFits(split)).toBe(false);
      expect(shortGivingWay(split, new Set())).toBe(0);
      // Without the sidebar, 100 short: said, not made.
      setSidebarRoom(0);
      expect(shortGivingWay(split, new Set())).toBe(100);
      // Said as too narrow, or too short when height is what it lacks.
      expect(refusal(split, new Set()).noRoom).toBe("narrow");
      setLayoutFits(() => ({ short: 300, panels: 200, low: true }));
      expect(refusal(split, new Set()).noRoom).toBe("low");
      setLayoutFits(() => ({ short: 300, panels: 200 }));
      // The panels go first, then the sidebar.
      askGiveWay(new Set());
      expect(givingWayNow()).toBe("panels");
      panelsGaveWay(false);
      expect(givingWayNow()).toBe("sidebar");
      sidebarGaveWay();
      expect(givingWayNow()).toBe(null);
    } finally {
      setLayoutFits(() => ({ short: 0, panels: 0 }));
      setSidebarRoom(0);
    }
  });
});
