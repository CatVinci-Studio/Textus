// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installTestLocalStorage } from "../dev/test-local-storage";
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
  sidebarMaxWidth,
  storedSidebarWidth,
  useSidebarWidth,
} from "./sidebar-width";

// No boot snapshot here: ui-state keeps the width in localStorage.
const KEY = "textus-sidebar-width";

beforeAll(installTestLocalStorage);
beforeEach(() => localStorage.clear());

describe("the sidebar's width bounds", () => {
  it("allows up to 480px on a wide window", () => {
    expect(sidebarMaxWidth(1920)).toBe(480);
  });

  it("allows under half of a small window", () => {
    expect(sidebarMaxWidth(800)).toBe(360);
  });

  it("never goes below the minimum, however small the window", () => {
    expect(sidebarMaxWidth(200)).toBe(SIDEBAR_MIN_WIDTH);
  });

  it("clamps into the bounds and rounds", () => {
    expect(clampSidebarWidth(50, 1400)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(9999, 1400)).toBe(480);
    expect(clampSidebarWidth(300.4, 1400)).toBe(300);
  });
});

describe("the remembered sidebar width", () => {
  it("defaults when nothing, or nothing usable, is stored", () => {
    expect(storedSidebarWidth()).toBe(SIDEBAR_DEFAULT_WIDTH);
    localStorage.setItem(KEY, "wide");
    expect(storedSidebarWidth()).toBe(SIDEBAR_DEFAULT_WIDTH);
    localStorage.setItem(KEY, "-20");
    expect(storedSidebarWidth()).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it("starts from the stored width", () => {
    localStorage.setItem(KEY, "320");
    const { result } = renderHook(() => useSidebarWidth(1400));
    expect(result.current.width).toBe(320);
  });

  it("shows a stored width too wide for the window narrower, and keeps it", () => {
    localStorage.setItem(KEY, "460");
    const { result, rerender } = renderHook(
      ({ windowWidth }) => useSidebarWidth(windowWidth),
      { initialProps: { windowWidth: 800 } },
    );
    expect(result.current.width).toBe(360);
    expect(result.current.max).toBe(360);
    rerender({ windowWidth: 1400 });
    expect(result.current.width).toBe(460);
  });

  it("remembers a drag only once it lets go", () => {
    const { result } = renderHook(() => useSidebarWidth(1400));
    act(() => result.current.setWidth(300, false));
    expect(result.current.width).toBe(300);
    expect(localStorage.getItem(KEY)).toBeNull();
    act(() => result.current.setWidth(310, true));
    expect(localStorage.getItem(KEY)).toBe("310");
  });

  it("stores the clamped width", () => {
    const { result } = renderHook(() => useSidebarWidth(1400));
    act(() => result.current.setWidth(5000));
    expect(result.current.width).toBe(480);
    expect(localStorage.getItem(KEY)).toBe("480");
  });

  it("resets to the default", () => {
    localStorage.setItem(KEY, "400");
    const { result } = renderHook(() => useSidebarWidth(1400));
    act(() => result.current.resetWidth());
    expect(result.current.width).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(localStorage.getItem(KEY)).toBe(String(SIDEBAR_DEFAULT_WIDTH));
  });
});
