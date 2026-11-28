// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A view's column on each frame of a width change, as the reader sees it:
// laid out at the view's end width from the first frame, it starts where
// it was and goes to where it ends without a step back. jsdom lays nothing
// out, so the column's place is worked out from what the clock wrote: the
// view's left, width and carry, and a column centred in its view (as a
// document's text, a settings page) or kept at its left edge.
const motion = vi.hoisted(() => ({ allowed: true }));
vi.mock("../motion/motion", () => ({
  motionAllowed: () => motion.allowed,
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

const px = (v: string) => parseFloat(v) || 0;
const shiftOf = (e: HTMLElement) =>
  Number(/translate\((-?[\d.e+-]+)px/.exec(e.style.transform)?.[1] ?? 0);

const COLUMN = 300;
const GUTTER = 20;

/** A view whose scroller carries a column: centred in the view's width
 *  (never closer than the gutter to its edge), or at its left edge. */
function view(key: string, centred: boolean) {
  const el = document.createElement("div");
  const scroller = document.createElement("div");
  scroller.setAttribute("data-frame-carry", "");
  const column = document.createElement("div");
  column.setAttribute("data-frame-column", "");
  scroller.appendChild(column);
  el.appendChild(scroller);
  const viewLeft = () => px(el.style.left) + shiftOf(el);
  const inView = () => {
    const w = px(el.style.width);
    return centred ? Math.max(GUTTER, (w - COLUMN) / 2) : GUTTER;
  };
  /** Where its text starts on screen now. */
  const text = () => viewLeft() + px(scroller.style.translate) + inView();
  const rect = (left: number, width: number) =>
    ({ left, width, right: left + width }) as DOMRect;
  el.getBoundingClientRect = () => rect(viewLeft(), px(el.style.width));
  column.getBoundingClientRect = () => rect(text(), COLUMN);
  frameClock.attach(key, el);
  return { el, scroller, text };
}

const box = (x: number, w: number) => ({ x, y: 0, w, h: 50 });
function parts(x: number, w: number): Map<string, FramePart> {
  return new Map<string, FramePart>([
    ["sheet", { rect: box(x, w) }],
    ["view", { rect: box(x, w), follow: "sheet" }],
  ]);
}
const ORIGIN = { x: 0, y: 0 };

/** The text's place on the change's first frame and every frame after,
 *  16 ms apart, until the run ends. */
function path(text: () => number, from = 1000): number[] {
  const xs = [text()];
  for (let now = from; queued.length; now += 16) {
    frame(now);
    xs.push(text());
  }
  return xs;
}

/** Each step goes the way from `start` to `end`, never back. */
function steady(xs: number[], start: number, end: number) {
  const way = Math.sign(end - start);
  for (let i = 1; i < xs.length; i++)
    expect((xs[i]! - xs[i - 1]!) * way).toBeGreaterThanOrEqual(-1e-9);
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
  for (let now = 1e9; queued.length; now += 1000) frame(now);
  frameClock.drop("islands");
  frameClock.attach("sheet", null);
  frameClock.attach("view", null);
  vi.unstubAllGlobals();
});

describe("a view's column as its width changes", () => {
  for (const [name, open, close] of [
    // The sidebar opening: the island's left edge moves right, it narrows.
    ["the sidebar opening", box(0, 1000), box(300, 700)],
    // The sidebar closing: the other way.
    ["the sidebar closing", box(300, 700), box(0, 1000)],
    // The AI opening on the right: the left edge stays, it narrows.
    ["the AI opening", box(0, 1000), box(0, 600)],
  ] as const)
    it(`starts where it was and goes straight to its end: ${name}`, () => {
      frameClock.attach("sheet", document.createElement("div"));
      const { text, scroller } = view("view", true);
      frameClock.set("islands", parts(open.x, open.w), ORIGIN, false);
      const start = text();
      frameClock.set("islands", parts(close.x, close.w), ORIGIN, true);
      const xs = path(text);
      const end = close.x + Math.max(GUTTER, (close.w - COLUMN) / 2);
      expect(xs[0]).toBeCloseTo(start, 6);
      expect(xs[xs.length - 1]).toBeCloseTo(end, 6);
      steady(xs, start, end);
      // Nothing left on it once there.
      expect(scroller.style.translate).toBe("");
    });

  it("on the island's curve: as far along as the island's edge", () => {
    const sheet = document.createElement("div");
    frameClock.attach("sheet", sheet);
    const { text } = view("view", true);
    frameClock.set("islands", parts(0, 1000), ORIGIN, false);
    const start = text();
    frameClock.set("islands", parts(300, 700), ORIGIN, true);
    frame(1000);
    frame(1200);
    const edge = px(sheet.style.left) / 300;
    const end = 300 + (700 - COLUMN) / 2;
    expect((text() - start) / (end - start)).toBeCloseTo(edge, 6);
  });

  it("leaves a column kept at the view's edge as the view carries it", () => {
    frameClock.attach("sheet", document.createElement("div"));
    const { text, scroller } = view("view", false);
    frameClock.set("islands", parts(0, 1000), ORIGIN, false);
    frameClock.set("islands", parts(300, 700), ORIGIN, true);
    expect(scroller.style.translate).toBe("");
    const xs = path(text);
    expect(xs[0]).toBe(GUTTER);
    steady(xs, GUTTER, 300 + GUTTER);
  });

  it("turned back mid-way, goes back from where it is drawn", () => {
    frameClock.attach("sheet", document.createElement("div"));
    const { text } = view("view", true);
    frameClock.set("islands", parts(0, 1000), ORIGIN, false);
    const start = text();
    frameClock.set("islands", parts(300, 700), ORIGIN, true);
    frame(1000);
    frame(1160);
    const mid = text();
    expect(mid).toBeGreaterThan(start);
    frameClock.set("islands", parts(0, 1000), ORIGIN, true);
    const xs = path(text, 1176);
    expect(xs[0]).toBeCloseTo(mid, 6);
    expect(xs[xs.length - 1]).toBeCloseTo(start, 6);
    steady(xs, mid, start);
  });

  it("under reduced motion arrives at once, nothing carried", () => {
    motion.allowed = false;
    frameClock.attach("sheet", document.createElement("div"));
    const { text, scroller } = view("view", true);
    frameClock.set("islands", parts(0, 1000), ORIGIN, false);
    frameClock.set("islands", parts(300, 700), ORIGIN, true);
    expect(scroller.style.translate).toBe("");
    expect(text()).toBe(300 + (700 - COLUMN) / 2);
  });

  it("is held from the size it was drawn at, whatever a render wrote since", () => {
    frameClock.attach("sheet", document.createElement("div"));
    const { el, text } = view("view", true);
    frameClock.set("islands", parts(0, 1000), ORIGIN, false);
    const start = text();
    // An island opening beside it draws the islands anew: its end size
    // is in its style before the clock hears of it.
    el.style.width = "600px";
    frameClock.set("islands", parts(0, 600), ORIGIN, true);
    expect(text()).toBeCloseTo(start, 6);
  });
});
