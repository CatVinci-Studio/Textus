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

  it("leaves no clip on a view it lets go (a sidebar turned a phone's)", () => {
    const aside = document.createElement("div");
    frameClock.attach("box", document.createElement("div"));
    frameClock.attach("view", aside);
    // A closed sidebar: shown clipped away to the room before the islands.
    frameClock.set(
      "frame",
      new Map<string, FramePart>([
        ["box", { rect: { x: 0, y: 0, w: 0, h: 100 } }],
        [
          "view",
          {
            rect: { x: 0, y: 0, w: 240, h: 100 },
            follow: "box",
            still: true,
            own: true,
          },
        ],
      ]),
      { x: 0, y: 0 },
      false,
    );
    expect(aside.style.clipPath).not.toBe("");
    frameClock.drop("frame");
    frameClock.attach("view", null);
    frameClock.attach("box", null);
    expect(aside.style.clipPath).toBe("");
    expect(aside.style.transform).toBe("");
  });
});
