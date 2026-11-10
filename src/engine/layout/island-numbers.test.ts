// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOLD_MS,
  holdStep,
  islandAnchors,
  islandNumbersShown,
  pickIsland,
  watchIslandNumbers,
} from "./island-numbers";
import { pairLayout, setSplitLayout, splitLayout } from "./store";
import { panesOf } from "./tree";
import { setFrameLayout } from "../frame/frame-store";

const mod = { type: "key", mod: true, digit: false, repeat: false } as const;
const other = { type: "key", mod: false, digit: false, repeat: false } as const;
const digit = { type: "key", mod: false, digit: true, repeat: false } as const;

describe("holdStep", () => {
  it("waits from ⌘ pressed alone, and shows once the wait is over with two islands", () => {
    expect(holdStep("idle", mod)).toBe("waiting");
    expect(holdStep("waiting", { type: "timer", islands: 2 })).toBe("shown");
  });

  it("shows nothing in a window of one island", () => {
    expect(holdStep("waiting", { type: "timer", islands: 1 })).toBe("waiting");
  });

  it("gives up the wait at any other key, a number included", () => {
    expect(holdStep("waiting", other)).toBe("idle");
    expect(holdStep("waiting", digit)).toBe("idle");
    // ⌘ still down repeats; it is not pressed anew.
    expect(holdStep("idle", { ...mod, repeat: true })).toBe("idle");
  });

  it("stays up over ⌘ and a number, and goes at any other key", () => {
    expect(holdStep("shown", digit)).toBe("shown");
    expect(holdStep("shown", { ...mod, repeat: true })).toBe("shown");
    expect(holdStep("shown", other)).toBe("idle");
  });

  it("ends when ⌘ is let go or the window is left", () => {
    expect(holdStep("waiting", { type: "end" })).toBe("idle");
    expect(holdStep("shown", { type: "end" })).toBe("idle");
  });
});

describe("the hold in a window", () => {
  const picked = vi.fn();
  let stop = () => {};
  const key = (type: string, key: string, init: KeyboardEventInit = {}) =>
    window.dispatchEvent(new KeyboardEvent(type, { key, ...init }));

  beforeEach(() => {
    vi.useFakeTimers();
    setSplitLayout(pairLayout("row", "left-tab", "right-tab"));
    const sheet = (x: number) => ({ x, y: 40, w: 400, h: 600 });
    setFrameLayout({
      islands: panesOf(splitLayout()!.root).map((pane, i) => ({
        paneId: pane.id,
        key: pane.id,
        row: null,
        sheet: sheet(i * 400),
        whole: sheet(i * 400),
        tabs: pane.tabs,
        front: pane.front,
      })),
      dividers: [],
      area: { x: 0, y: 40, w: 800, h: 600 },
      origin: { x: 0, y: 0 },
    });
    stop = watchIslandNumbers(false, picked);
  });

  afterEach(() => {
    stop();
    picked.mockClear();
    setSplitLayout(null);
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("lists the islands in the layout's order", () => {
    expect(islandAnchors().map((anchor) => anchor.paneId)).toEqual(
      panesOf(splitLayout()!.root).map((pane) => pane.id),
    );
  });

  it("shows the numbers after Ctrl is held alone, and a number then goes to that island's tab", () => {
    key("keydown", "Control", { ctrlKey: true });
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(islandNumbersShown()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(islandNumbersShown()).toBe(true);
    key("keydown", "2", { ctrlKey: true });
    expect(pickIsland(2)).toBe(true);
    expect(picked).toHaveBeenCalledWith("right-tab");
    // Taken, with no such island: never a heading while they show.
    expect(pickIsland(5)).toBe(true);
    expect(picked).toHaveBeenCalledTimes(1);
    key("keyup", "Control");
    expect(islandNumbersShown()).toBe(false);
  });

  it("leaves a number pressed before they show to the heading", () => {
    key("keydown", "Control", { ctrlKey: true });
    vi.advanceTimersByTime(100);
    key("keydown", "2", { ctrlKey: true });
    expect(pickIsland(2)).toBe(false);
    vi.advanceTimersByTime(HOLD_MS);
    expect(islandNumbersShown()).toBe(false);
    expect(picked).not.toHaveBeenCalled();
  });

  it("hides them at another key, a press of the pointer, or the window left", () => {
    for (const leave of [
      () => key("keydown", "c", { ctrlKey: true }),
      () => window.dispatchEvent(new Event("pointerdown")),
      () => window.dispatchEvent(new Event("blur")),
    ]) {
      key("keydown", "Control", { ctrlKey: true });
      vi.advanceTimersByTime(HOLD_MS);
      expect(islandNumbersShown()).toBe(true);
      leave();
      expect(islandNumbersShown()).toBe(false);
      key("keyup", "Control");
    }
  });

  it("shows nothing for Ctrl with Shift or Alt", () => {
    key("keydown", "Control", { ctrlKey: true, shiftKey: true });
    vi.advanceTimersByTime(HOLD_MS);
    expect(islandNumbersShown()).toBe(false);
  });

  it("shows nothing once the window is back to one island", () => {
    setSplitLayout(null);
    key("keydown", "Control", { ctrlKey: true });
    vi.advanceTimersByTime(HOLD_MS);
    expect(islandNumbersShown()).toBe(false);
  });
});
