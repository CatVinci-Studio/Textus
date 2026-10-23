// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isFullscreen = vi.fn(() => Promise.resolve(false));
const unlisten = vi.fn();
let onFullscreen: ((event: { payload: boolean }) => void) | null = null;
const listen = vi.fn(
  (_event: string, handler: (event: { payload: boolean }) => void) => {
    onFullscreen = handler;
    return Promise.resolve(unlisten);
  },
);
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFullscreen, listen }),
}));

import { useFullscreenMark } from "./useFullscreenMark";

const root = document.documentElement;
const marked = () => "windowFullscreen" in root.dataset;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the full-screen mark", () => {
  beforeEach(() => {
    root.dataset.windowChrome = "native";
    onFullscreen = null;
    isFullscreen.mockResolvedValue(false);
    listen.mockClear();
    unlisten.mockClear();
  });
  afterEach(() => {
    delete root.dataset.windowChrome;
  });

  it("follows AppKit's word, in and out", async () => {
    const { unmount } = renderHook(() => useFullscreenMark());
    await settle();
    expect(listen).toHaveBeenCalledWith(
      "window-fullscreen",
      expect.any(Function),
    );
    expect(marked()).toBe(false);
    onFullscreen!({ payload: true });
    expect(marked()).toBe(true);
    onFullscreen!({ payload: false });
    expect(marked()).toBe(false);
    unmount();
  });

  it("a window opened in full screen starts marked", async () => {
    isFullscreen.mockResolvedValue(true);
    const { unmount } = renderHook(() => useFullscreenMark());
    await settle();
    expect(marked()).toBe(true);
    unmount();
    expect(marked()).toBe(false);
    expect(unlisten).toHaveBeenCalled();
  });

  it("a resize alone changes nothing", async () => {
    const { unmount } = renderHook(() => useFullscreenMark());
    await settle();
    Object.defineProperty(window, "innerWidth", {
      value: window.screen.width,
      configurable: true,
    });
    window.dispatchEvent(new Event("resize"));
    expect(marked()).toBe(false);
    unmount();
  });

  it("asks nothing off the Mac", async () => {
    root.dataset.windowChrome = "app";
    isFullscreen.mockClear();
    const { unmount } = renderHook(() => useFullscreenMark());
    await settle();
    expect(isFullscreen).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
    unmount();
  });
});
