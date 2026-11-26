// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdTransitionsOnThemeChange } from "./restyle-hold";
import { onAppearance, writeThemeStyle } from "../engine/tokens/appearance";

const root = document.documentElement;
const settle = () => new Promise((done) => setTimeout(done, 0));
let frames: FrameRequestCallback[] = [];
const nextFrame = () => {
  const now = frames;
  frames = [];
  now.forEach((run) => run(0));
};
let stop = () => {};

beforeEach(() => {
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((run) => {
    frames.push(run);
    return frames.length;
  });
  stop = holdTransitionsOnThemeChange();
});

afterEach(() => {
  stop();
  vi.restoreAllMocks();
  root.removeAttribute("data-theme");
  root.className = "";
});

describe("holdTransitionsOnThemeChange", () => {
  it("turns transitions off for the two frames a theme switch takes", async () => {
    const heard = vi.fn();
    const stopHearing = onAppearance(heard);
    root.setAttribute("data-theme", "dark");
    await settle();
    expect(root.hasAttribute("data-restyling")).toBe(true);
    nextFrame();
    expect(root.hasAttribute("data-restyling")).toBe(true);
    nextFrame();
    await settle();
    expect(root.hasAttribute("data-restyling")).toBe(false);
    // Its own mark is no change of look.
    expect(heard).toHaveBeenCalledTimes(1);
    stopHearing();
  });

  it("tells a theme's stylesheet rewritten without reading its text", async () => {
    const style = document.createElement("style");
    style.id = "textus-user-css";
    let reads = 0;
    Object.defineProperty(style, "textContent", {
      get: () => (reads++, "a"),
      set: () => {},
      configurable: true,
    });
    document.head.appendChild(style);
    writeThemeStyle(style, "b");
    await settle();
    expect(root.hasAttribute("data-restyling")).toBe(true);
    expect(reads).toBe(0);
    style.remove();
  });

  it("leaves other changes of look their animations", async () => {
    root.classList.add("zen");
    await settle();
    expect(root.hasAttribute("data-restyling")).toBe(false);
  });
});
