// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const win = vi.hoisted(() => ({
  maximized: false,
  fullscreen: false,
  resized: undefined as undefined | (() => void),
  told: undefined as undefined | ((event: { payload: boolean }) => void),
}));

vi.mock("./this-window", () => ({
  thisWindow: () => ({
    isMaximized: () => Promise.resolve(win.maximized),
    isFullscreen: () => Promise.resolve(win.fullscreen),
    onResized: (handler: () => void) => {
      win.resized = handler;
      return Promise.resolve(() => {});
    },
    listen: (_: string, handler: (event: { payload: boolean }) => void) => {
      win.told = handler;
      return Promise.resolve(() => {});
    },
  }),
}));

import { useWindowState } from "./window-state";

beforeEach(() => vi.useFakeTimers());

describe("the window's full-screen state", () => {
  it("keeps AppKit's word while the window, mid-animation, still answers the old state", async () => {
    const { result } = renderHook(() => useWindowState());
    await act(async () => {});
    expect(result.current.fullscreen).toBe(false);

    // Full screen starts: AppKit says so before its animation.
    act(() => win.told!({ payload: true }));
    expect(result.current.fullscreen).toBe(true);

    // The animation resizes the window, which still says it isn't.
    win.fullscreen = false;
    win.resized!();
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.fullscreen).toBe(true);
  });
});

describe("the window's maximized state", () => {
  it("is asked as a resize burst starts, not only once it settles", async () => {
    const { result } = renderHook(() => useWindowState());
    await act(async () => {});
    expect(result.current.maximized).toBe(false);

    // Maximize is a single resize: the caption buttons change with it.
    win.maximized = true;
    win.resized!();
    await act(async () => {});
    expect(result.current.maximized).toBe(true);

    // Each later resize of the burst waits for its end.
    win.maximized = false;
    win.resized!();
    await act(async () => {});
    expect(result.current.maximized).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.maximized).toBe(false);
  });
});
