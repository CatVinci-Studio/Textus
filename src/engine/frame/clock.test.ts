// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { frameClock, type FramePart } from "./clock";

const tab = (x: number) => ({ x, y: 0, w: 80, h: 0 });
const row = (x: number) =>
  new Map<string, FramePart>([["t", { rect: tab(x), along: true }]]);

afterEach(() => {
  frameClock.drop("strip");
  frameClock.attach("t", null);
});

describe("frameClock", () => {
  it("brings home a part a gesture left elsewhere, its place unchanged", () => {
    const el = document.createElement("div");
    frameClock.attach("t", el);
    frameClock.set("strip", row(0), { x: 0, y: 0 }, false);
    // Dragged 120px and let go where it started: drawn at the pointer,
    // then the same layout again.
    frameClock.place("t", tab(120));
    expect(el.style.left).toBe("120px");
    frameClock.set("strip", row(0), { x: 0, y: 0 }, false);
    expect(el.style.left).toBe("0px");
  });

  it("writes nothing for a layout already drawn", () => {
    const el = document.createElement("div");
    frameClock.attach("t", el);
    frameClock.set("strip", row(0), { x: 0, y: 0 }, false);
    el.style.left = "7px";
    frameClock.set("strip", row(0), { x: 0, y: 0 }, false);
    expect(el.style.left).toBe("7px");
  });
});
