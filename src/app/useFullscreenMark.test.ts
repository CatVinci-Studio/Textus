// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isFullscreen = vi.fn(() => Promise.resolve(false));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFullscreen }),
}));

import { useFullscreenMark } from "./useFullscreenMark";

const root = document.documentElement;

function size(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    value: width,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: height,
    configurable: true,
  });
}

describe("the full-screen mark", () => {
  beforeEach(() => {
    Object.defineProperty(window, "screen", {
      value: { width: 1512, height: 982 },
      configurable: true,
    });
    size(1100, 760);
    root.dataset.windowChrome = "native";
  });
  afterEach(() => {
    delete root.dataset.windowChrome;
    vi.useRealTimers();
  });

  it("follows the window filling the screen at once, not after the backend", () => {
    const { unmount } = renderHook(() => useFullscreenMark());
    expect("windowFullscreen" in root.dataset).toBe(false);
    size(1512, 982);
    window.dispatchEvent(new Event("resize"));
    expect("windowFullscreen" in root.dataset).toBe(true);
    size(1100, 760);
    window.dispatchEvent(new Event("resize"));
    expect("windowFullscreen" in root.dataset).toBe(false);
    unmount();
  });

  it("a zoomed window, below the menu bar, is not full screen", () => {
    const { unmount } = renderHook(() => useFullscreenMark());
    size(1512, 945);
    window.dispatchEvent(new Event("resize"));
    expect("windowFullscreen" in root.dataset).toBe(false);
    unmount();
  });

  it("the backend's answer has the last word once the resize settles", async () => {
    vi.useFakeTimers();
    isFullscreen.mockResolvedValue(true);
    const { unmount } = renderHook(() => useFullscreenMark());
    window.dispatchEvent(new Event("resize"));
    await vi.advanceTimersByTimeAsync(150);
    expect("windowFullscreen" in root.dataset).toBe(true);
    unmount();
    expect("windowFullscreen" in root.dataset).toBe(false);
  });

  it("asks nothing off the Mac", () => {
    root.dataset.windowChrome = "app";
    isFullscreen.mockClear();
    const { unmount } = renderHook(() => useFullscreenMark());
    size(1512, 982);
    window.dispatchEvent(new Event("resize"));
    expect("windowFullscreen" in root.dataset).toBe(false);
    expect(isFullscreen).not.toHaveBeenCalled();
    unmount();
  });
});
