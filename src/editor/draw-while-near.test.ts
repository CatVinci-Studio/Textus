// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  drawEverything,
  drawWhileNear,
  PENDING_ATTR,
} from "./draw-when-visible";

type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void;
let fire: Callback = () => {};

class FakeObserver {
  constructor(callback: Callback) {
    fire = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function setup() {
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  const scroller = document.createElement("div");
  scroller.className = "editor-scroll";
  const editor = document.createElement("div");
  const el = document.createElement("div");
  editor.append(el);
  scroller.append(editor);
  document.body.append(scroller);
  const draw = vi.fn();
  const undraw = vi.fn();
  drawWhileNear(el, editor, draw, undraw);
  return { scroller, el, draw, undraw };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("drawWhileNear", () => {
  it("draws near the screen and lets go far from it, keeping its height", () => {
    const { el, draw, undraw } = setup();
    expect(draw).not.toHaveBeenCalled();
    fire([{ isIntersecting: true, target: el }]);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(el.hasAttribute(PENDING_ATTR)).toBe(false);
    fire([{ isIntersecting: false, target: el }]);
    expect(undraw).toHaveBeenCalledTimes(1);
    expect(el.hasAttribute(PENDING_ATTR)).toBe(true);
    expect(el.style.minHeight).toBe("0px");
    fire([{ isIntersecting: true, target: el }]);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(el.style.minHeight).toBe("");
  });

  it("draws a far one for an export", async () => {
    const { scroller, draw } = setup();
    await drawEverything(scroller);
    expect(draw).toHaveBeenCalledTimes(1);
  });
});
