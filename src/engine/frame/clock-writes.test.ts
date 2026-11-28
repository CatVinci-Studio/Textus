// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What the clock writes per frame: only the parts that move, and a view's
// end rect once. A write the element already holds is not made at all.
vi.mock("../motion/motion", () => ({
  motionAllowed: () => true,
  duration: () => 400,
  easing: () => "linear",
}));

import { frameClock, type FramePart } from "./clock";

let queued: FrameRequestCallback[] = [];
function frame(now: number) {
  const due = queued;
  queued = [];
  for (const cb of due) cb(now);
}

/** Each element's style writes, by property, since the last `clear`. */
const writes = new Map<string, string[]>();
const clear = () => writes.clear();
const used = new Set<string>();
const groups = new Set<string>();

/** An element whose style records every write made to it. */
function recorded(key: string): HTMLElement {
  const style = document.createElement("div").style;
  const proxy = new Proxy(style, {
    get: (target, prop) => Reflect.get(target, prop, target),
    set: (target, prop, value) => {
      const list = writes.get(key) ?? [];
      list.push(String(prop));
      writes.set(key, list);
      return Reflect.set(target, prop, value, target);
    },
  });
  const el = { style: proxy } as unknown as HTMLElement;
  frameClock.attach(key, el);
  used.add(key);
  return el;
}

function set(name: string, parts: [string, FramePart][], animate = true) {
  groups.add(name);
  frameClock.set(name, new Map(parts), { x: 0, y: 0 }, animate);
}

const box = (x: number, w = 100) => ({ x, y: 0, w, h: 50 });

beforeEach(() => {
  queued = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queued.push(cb);
    return queued.length;
  });
});

afterEach(() => {
  for (let now = 1e9; queued.length; now += 1000) frame(now);
  for (const g of groups) frameClock.drop(g);
  for (const k of used) frameClock.attach(k, null);
  groups.clear();
  used.clear();
  writes.clear();
  vi.unstubAllGlobals();
});

describe("frame clock writes", () => {
  it("writes nothing to a group that isn't moving while another runs", () => {
    recorded("pill");
    recorded("sheet");
    set(
      "strip",
      [["pill", { rect: { x: 0, y: 0, w: 80, h: 0 }, along: true }]],
      false,
    );
    set("islands", [["sheet", { rect: box(0) }]], false);
    clear();
    set("islands", [["sheet", { rect: box(100) }]]);
    for (let now = 1000; queued.length; now += 16) frame(now);
    expect(writes.get("pill")).toBeUndefined();
    expect(writes.get("sheet")?.length).toBeGreaterThan(0);
  });

  it("leaves a part of the moving group alone when it stays put", () => {
    recorded("a");
    recorded("b");
    const parts = (x: number): [string, FramePart][] => [
      ["a", { rect: box(x) }],
      ["b", { rect: box(500) }],
    ];
    set("islands", parts(0), false);
    clear();
    set("islands", parts(100));
    for (let now = 1000; queued.length; now += 16) frame(now);
    expect(writes.get("b")).toBeUndefined();
  });

  it("writes a view's end rect once, then only its carry and clip", () => {
    recorded("sheet");
    recorded("view");
    const parts = (x: number, w: number): [string, FramePart][] => [
      ["sheet", { rect: box(x, w) }],
      ["view", { rect: box(x, w), follow: "sheet" }],
    ];
    set("islands", parts(0, 400), false);
    clear();
    set("islands", parts(200, 200));
    for (let now = 1000; queued.length; now += 16) frame(now);
    const view = writes.get("view") ?? [];
    for (const prop of ["left", "top", "width", "height"])
      expect(view.filter((p) => p === prop).length).toBeLessThanOrEqual(1);
    expect(view.filter((p) => p === "transform").length).toBeGreaterThan(5);
  });

  it("writes no value an element already holds", () => {
    recorded("sheet");
    set("islands", [["sheet", { rect: box(0, 100) }]], false);
    clear();
    // Only its width changes.
    set("islands", [["sheet", { rect: box(0, 200) }]], false);
    expect(writes.get("sheet")).toEqual(["width"]);
  });

  it("writes a value again that React changed under it", () => {
    const sheet = recorded("sheet");
    set("islands", [["sheet", { rect: box(0) }]], false);
    // A render placed it at its next end before the clock starts there.
    sheet.style.left = "100px";
    set("islands", [["sheet", { rect: box(100) }]]);
    expect(sheet.style.left).toBe("0px");
  });
});
