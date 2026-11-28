// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The clock's motion as the user sees it: where each part is drawn on each
// frame, where it ends, what an interruption and reduced motion do. A
// linear curve over 400 ms and a hand-driven rAF make the frames exact.
const motion = vi.hoisted(() => ({ allowed: true }));
vi.mock("../motion/motion", () => ({
  motionAllowed: () => motion.allowed,
  duration: () => 400,
  easing: () => "linear",
}));

import { frameClock, type FramePart } from "./clock";

let queued: FrameRequestCallback[] = [];
/** Draws one frame at `now`: the callbacks asked for before it. */
function frame(now: number) {
  const due = queued;
  queued = [];
  for (const cb of due) cb(now);
}

/** A transform as numbers: engines spell a zero y differently. */
const shift = (e: HTMLElement) => {
  const m = /translate\((-?[\d.]+)px(?:, (-?[\d.]+)px)?\)/.exec(
    e.style.transform,
  );
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : [0, 0];
};

const box = (x: number, w = 100) => ({ x, y: 10, w, h: 50 });
const used = new Set<string>();
const groups = new Set<string>();

function el(key: string): HTMLElement {
  const e = document.createElement("div");
  frameClock.attach(key, e);
  used.add(key);
  return e;
}

function set(
  name: string,
  parts: [string, FramePart][],
  animate = true,
  origin = { x: 0, y: 0 },
) {
  groups.add(name);
  frameClock.set(name, new Map(parts), origin, animate);
}

beforeEach(() => {
  motion.allowed = true;
  queued = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queued.push(cb);
    return queued.length;
  });
});

afterEach(() => {
  // Ends any run left over (its first frame sets its start), then lets
  // everything go.
  for (let now = 1e9; queued.length; now += 1000) frame(now);
  for (const g of groups) frameClock.drop(g);
  for (const k of used) frameClock.attach(k, null);
  groups.clear();
  used.clear();
  vi.unstubAllGlobals();
});

describe("frame clock motion", () => {
  it("moves a box from where it is to its end on the curve, then stops", () => {
    const sheet = el("sheet");
    set("islands", [["sheet", { rect: box(0) }]], false);
    set("islands", [["sheet", { rect: box(100, 200) }]]);
    // The change's first frame: still where it was.
    expect(sheet.style.left).toBe("0px");
    expect(sheet.style.width).toBe("100px");
    frame(1000);
    expect(sheet.style.left).toBe("0px");
    frame(1200);
    expect(sheet.style.left).toBe("50px");
    expect(sheet.style.width).toBe("150px");
    expect(sheet.style.top).toBe("10px");
    expect(sheet.style.height).toBe("50px");
    frame(1400);
    expect(sheet.style.left).toBe("100px");
    expect(sheet.style.width).toBe("200px");
    expect(queued).toHaveLength(0);
  });

  it("writes each part relative to its group's origin", () => {
    const sheet = el("sheet");
    set("islands", [["sheet", { rect: box(100) }]], false, { x: 40, y: 4 });
    expect(sheet.style.left).toBe("60px");
    expect(sheet.style.top).toBe("6px");
  });

  it("carries a view at its end size on the box it lies on, clipped to it", () => {
    const sheet = el("sheet");
    const view = el("view");
    const parts = (x: number, w: number): [string, FramePart][] => [
      ["sheet", { rect: box(x, w) }],
      ["view", { rect: box(x, w), follow: "sheet" }],
    ];
    set("islands", parts(0, 400), false);
    set("islands", parts(200, 200));
    // Laid out at its end at once: its text reflows once, not per frame.
    expect(view.style.left).toBe("200px");
    expect(view.style.width).toBe("200px");
    expect(shift(view)).toEqual([-200, 0]);
    expect(view.style.clipPath).toBe("");
    frame(1000);
    frame(1200);
    expect(sheet.style.left).toBe("100px");
    expect(sheet.style.width).toBe("300px");
    expect(shift(view)).toEqual([-100, 0]);
    // The sheet is wider than the view now: nothing to clip on the right.
    expect(view.style.clipPath).toBe("");
    frame(1400);
    expect(view.style.left).toBe("200px");
    expect(view.style.transform).toBe("");
    expect(view.style.clipPath).toBe("");
  });

  it("clips a view wider than the box still growing under it", () => {
    el("sheet");
    const view = el("view");
    set(
      "islands",
      [
        ["sheet", { rect: box(0, 400), grows: "right" }],
        ["view", { rect: box(0, 400), follow: "sheet" }],
      ],
      true,
    );
    // New, growing in from the right: none of it shown yet.
    expect(shift(view)).toEqual([400, 0]);
    expect(view.style.clipPath).toBe("inset(0px 400px 0px 0px)");
    frame(1000);
    frame(1200);
    expect(shift(view)).toEqual([200, 0]);
    expect(view.style.clipPath).toBe("inset(0px 200px 0px 0px)");
    frame(1400);
    expect(view.style.transform).toBe("");
    expect(view.style.clipPath).toBe("");
  });

  it("stands a row above its sheet, carried along with it", () => {
    el("sheet");
    const row = el("row");
    const parts = (x: number): [string, FramePart][] => [
      [
        "row",
        { rect: { x, y: 0, w: 100, h: 10 }, follow: "sheet", above: true },
      ],
      ["sheet", { rect: box(x) }],
    ];
    set("islands", parts(0), false);
    set("islands", parts(100));
    frame(1000);
    frame(1200);
    expect(row.style.left).toBe("100px");
    expect(shift(row)).toEqual([-50, 0]);
    frame(1400);
    expect(row.style.transform).toBe("");
  });

  it("slides a part along its row by its place and width only", () => {
    const pill = el("pill");
    const along = (x: number): [string, FramePart][] => [
      ["pill", { rect: { x, y: 0, w: 80, h: 0 }, along: true }],
    ];
    set("strip", along(0), false);
    set("strip", along(120));
    frame(1000);
    frame(1200);
    expect(pill.style.left).toBe("60px");
    expect(pill.style.width).toBe("80px");
    expect(pill.style.top).toBe("");
    expect(pill.style.height).toBe("");
    frame(1400);
    expect(pill.style.left).toBe("120px");
  });

  it("turns mid-run from where the part is drawn, without a jump", () => {
    const sheet = el("sheet");
    set("islands", [["sheet", { rect: box(0) }]], false);
    set("islands", [["sheet", { rect: box(100) }]]);
    frame(1000);
    frame(1200);
    expect(sheet.style.left).toBe("50px");
    set("islands", [["sheet", { rect: box(0) }]]);
    expect(sheet.style.left).toBe("50px");
    frame(1216);
    expect(sheet.style.left).toBe("50px");
    frame(1416);
    expect(sheet.style.left).toBe("25px");
    frame(1616);
    expect(sheet.style.left).toBe("0px");
    expect(queued).toHaveLength(0);
  });

  it("keeps going, not started over, when told the same end again", () => {
    const sheet = el("sheet");
    set("islands", [["sheet", { rect: box(0) }]], false);
    set("islands", [["sheet", { rect: box(100) }]]);
    frame(1000);
    frame(1200);
    set("islands", [["sheet", { rect: box(100) }]]);
    frame(1300);
    expect(sheet.style.left).toBe("75px");
  });

  it("puts everything at its end at once when told not to animate mid-run", () => {
    const sheet = el("sheet");
    const view = el("view");
    const parts = (x: number): [string, FramePart][] => [
      ["sheet", { rect: box(x) }],
      ["view", { rect: box(x), follow: "sheet" }],
    ];
    set("islands", parts(0), false);
    set("islands", parts(100));
    frame(1000);
    frame(1200);
    set("islands", parts(300), false);
    expect(sheet.style.left).toBe("300px");
    expect(view.style.left).toBe("300px");
    expect(view.style.transform).toBe("");
    expect(view.style.clipPath).toBe("");
  });

  it("under reduced motion, nothing travels: every part arrives at once", () => {
    motion.allowed = false;
    const sheet = el("sheet");
    const view = el("view");
    const pill = el("pill");
    const parts = (x: number): [string, FramePart][] => [
      ["sheet", { rect: box(x), grows: "right" }],
      ["view", { rect: box(x), follow: "sheet" }],
      ["pill", { rect: { x, y: 0, w: 80, h: 0 }, along: true }],
    ];
    set("islands", parts(0));
    set("islands", parts(100));
    expect(queued).toHaveLength(0);
    expect(sheet.style.left).toBe("100px");
    expect(pill.style.left).toBe("100px");
    expect(view.style.left).toBe("100px");
    expect(view.style.transform).toBe("");
    expect(view.style.clipPath).toBe("");
  });

  it("moves a part on from where a gesture let it go", () => {
    const pill = el("pill");
    const along = (x: number): [string, FramePart][] => [
      ["pill", { rect: { x, y: 0, w: 80, h: 0 }, along: true }],
    ];
    set("strip", along(0), false);
    frameClock.place("pill", { x: 200, y: 0, w: 80, h: 0 });
    expect(pill.style.left).toBe("200px");
    set("strip", along(100));
    frame(1000);
    frame(1200);
    expect(pill.style.left).toBe("150px");
    frame(1400);
    expect(pill.style.left).toBe("100px");
  });

  it("reveals a view of its own by the room before another group's box", () => {
    el("before");
    const aside = el("aside");
    set("islands", [["before", { rect: { x: 0, y: 0, w: 0, h: 100 } }]], false);
    set(
      "sidebar",
      [
        [
          "aside",
          {
            rect: { x: 0, y: 0, w: 240, h: 100 },
            follow: "before",
            still: true,
            own: true,
          },
        ],
      ],
      false,
    );
    expect(aside.style.clipPath).toBe("inset(0px 240px 0px 0px)");
    // Its own stylesheet places it: the clock never sizes it.
    expect(aside.style.width).toBe("");
    set("islands", [["before", { rect: { x: 0, y: 0, w: 240, h: 100 } }]]);
    frame(1000);
    frame(1200);
    expect(aside.style.clipPath).toBe("inset(0px 120px 0px 0px)");
    expect(aside.style.transform).toBe("");
    frame(1400);
    expect(aside.style.clipPath).toBe("");
  });

  it("draws a new element for a part already placed where it is at once", () => {
    set("islands", [["sheet", { rect: box(70) }]], false);
    groups.add("islands");
    const sheet = el("sheet");
    expect(sheet.style.left).toBe("70px");
  });
});

describe("frame clock settling", () => {
  it("is moving while a run goes and tells its end once", () => {
    el("sheet");
    let told = 0;
    const stop = frameClock.onSettled(() => told++);
    set("islands", [["sheet", { rect: box(0) }]], false);
    expect(frameClock.moving()).toBe(false);
    set("islands", [["sheet", { rect: box(100) }]]);
    expect(frameClock.moving()).toBe(true);
    expect(told).toBe(0);
    frame(1000);
    expect(told).toBe(0);
    frame(1200);
    expect(told).toBe(0);
    // Turned mid-way: still one motion.
    set("islands", [["sheet", { rect: box(20) }]]);
    frame(1300);
    expect(told).toBe(0);
    frame(1700);
    expect(frameClock.moving()).toBe(false);
    expect(told).toBe(1);
    frame(1800);
    expect(told).toBe(1);
    stop();
  });

  it("tells the end of a run put at its end at once", () => {
    el("sheet");
    let told = 0;
    const stop = frameClock.onSettled(() => told++);
    set("islands", [["sheet", { rect: box(0) }]], false);
    set("islands", [["sheet", { rect: box(100) }]]);
    set("islands", [["sheet", { rect: box(200) }]], false);
    expect(frameClock.moving()).toBe(false);
    expect(told).toBe(1);
    stop();
  });
});
