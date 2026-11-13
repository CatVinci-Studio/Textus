// @vitest-environment jsdom

import {
  clampSidePanel,
  sidePanelMax,
} from "../../engine/controls/side-panel-width";
import { act, renderHook } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installTestLocalStorage } from "../../dev/test-local-storage";
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_LIMITS,
  storedSidebarWidth,
  useSidebarWidth,
} from "./sidebar-width";

// No boot snapshot here: ui-state keeps the width in localStorage.
const KEY = "textus-sidebar-px";

beforeAll(installTestLocalStorage);
// Widths here are at Medium, the interface's scale of 1.
beforeEach(() => localStorage.clear());

describe("the sidebar's width bounds", () => {
  it("allows up to 528px on a wide window", () => {
    expect(sidePanelMax(1920, SIDEBAR_LIMITS)).toBe(528);
    // Beside a document and the AI, the islands keep what they need.
    expect(sidePanelMax(1200, SIDEBAR_LIMITS, 48, 1, 860)).toBe(292);
  });

  it("allows under half of a small window", () => {
    expect(sidePanelMax(800, SIDEBAR_LIMITS)).toBe(360);
  });

  it("never goes below the minimum, however small the window", () => {
    expect(sidePanelMax(200, SIDEBAR_LIMITS)).toBe(SIDEBAR_MIN_WIDTH);
  });

  it("clamps into the bounds and rounds", () => {
    expect(clampSidePanel(50, 1400, SIDEBAR_LIMITS)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidePanel(9999, 1400, SIDEBAR_LIMITS)).toBe(528);
    expect(clampSidePanel(300.4, 1400, SIDEBAR_LIMITS)).toBe(300);
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

  it("takes a width kept before 1.4.1 to Medium's pixels", () => {
    localStorage.setItem("textus-sidebar-width", "240");
    expect(storedSidebarWidth()).toBe(264);
    localStorage.setItem(KEY, "300");
    expect(storedSidebarWidth()).toBe(300);
  });

  it("starts from the stored width", () => {
    localStorage.setItem(KEY, "320");
    const { result } = renderHook(() => useSidebarWidth(1200));
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
    rerender({ windowWidth: 1200 });
    expect(result.current.width).toBe(460);
  });

  it("while held, moves only the shell's column and the sidebar; remembers where it lets go", () => {
    const shell = document.body.appendChild(document.createElement("div"));
    shell.className = "app-shell";
    const sidebar = shell.appendChild(document.createElement("aside"));
    sidebar.className = "sidebar";
    const { result } = renderHook(() => useSidebarWidth(1200));
    act(() => result.current.setWidth(300, false));
    expect(shell.style.gridTemplateColumns).toContain("300px");
    expect(sidebar.style.width).toBe("300px");
    // Not the inherited variable: that would restyle the whole window.
    expect(shell.style.getPropertyValue("--sidebar-width")).toBe("");
    expect(result.current.width).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(localStorage.getItem(KEY)).toBeNull();
    act(() => result.current.setWidth(310, true));
    expect(result.current.width).toBe(310);
    expect(localStorage.getItem(KEY)).toBe("310");
    shell.remove();
  });

  it("stores the clamped width", () => {
    const { result } = renderHook(() => useSidebarWidth(1200));
    act(() => result.current.setWidth(5000));
    expect(result.current.width).toBe(528);
    expect(localStorage.getItem(KEY)).toBe("528");
  });

  it("keeps its width in a wide window: the interface doesn't grow with it", () => {
    localStorage.setItem(KEY, "240");
    const { result } = renderHook(() => useSidebarWidth(2560));
    expect(result.current.width).toBe(240);
    act(() => result.current.setWidth(345));
    expect(localStorage.getItem(KEY)).toBe("345");
  });

  it("resets to the default", () => {
    localStorage.setItem(KEY, "400");
    const { result } = renderHook(() => useSidebarWidth(1200));
    act(() => result.current.resetWidth());
    expect(result.current.width).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(localStorage.getItem(KEY)).toBe(String(SIDEBAR_DEFAULT_WIDTH));
  });
});
