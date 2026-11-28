// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installTestLocalStorage } from "../../dev/test-local-storage";
import { enter } from "../../engine/controls/moves";
import {
  storeSidebarTab,
  storedSidebarTab,
  usePanelSwitchMotion,
} from "./sidebar-tab";

// What the panel's box is asked to do, not how a browser plays it.
vi.mock("../../engine/controls/moves", () => ({ enter: vi.fn(() => null) }));

// No boot snapshot here: ui-state keeps the tab in localStorage.
const KEY = "textus-sidebar-tab";

beforeAll(installTestLocalStorage);
beforeEach(() => localStorage.clear());

describe("the remembered sidebar tab", () => {
  it("is Files when nothing is stored", () => {
    expect(storedSidebarTab()).toBe("tree");
  });

  it("comes back as it was stored", () => {
    storeSidebarTab("outline");
    expect(localStorage.getItem(KEY)).toBe("outline");
    expect(storedSidebarTab()).toBe("outline");
    storeSidebarTab("outline");
    expect(storedSidebarTab()).toBe("outline");
  });

  it("is Files when the stored tab is one this build doesn't have", () => {
    localStorage.setItem(KEY, "graph");
    expect(storedSidebarTab()).toBe("tree");
    localStorage.setItem(KEY, "");
    expect(storedSidebarTab()).toBe("tree");
  });
});

describe("the sidebar's tabs in the user's order", () => {
  it("keeps the order dragged, and puts a tab new since then after the one before it", async () => {
    const { orderTabs } = await import("./sidebar-tabs");
    const tabs = ["tree", "outline", "pages", "tasks"].map((id) => ({ id }));
    expect(
      orderTabs(tabs, ["pages", "tree", "outline"]).map((t) => t.id),
    ).toEqual(["pages", "tasks", "tree", "outline"]);
    expect(orderTabs(tabs, ["tasks", "tree"]).map((t) => t.id)).toEqual([
      "tasks",
      "tree",
      "outline",
      "pages",
    ]);
    expect(orderTabs(tabs, ["gone", "outline"]).map((t) => t.id)).toEqual([
      "tree",
      "outline",
      "pages",
      "tasks",
    ]);
  });
});

describe("a panel taking another's place", () => {
  beforeEach(() => vi.mocked(enter).mockClear());

  /** The hook with its box attached, as the sidebar draws it. */
  function sidebar(id: string, open: boolean) {
    const box = document.createElement("div");
    const view = renderHook(
      (props: { id: string; open: boolean }) => {
        const ref = usePanelSwitchMotion(props.id, props.open);
        ref.current = box;
        return ref;
      },
      { initialProps: { id, open } },
    );
    return {
      box,
      show: (next: string, on = true) => view.rerender({ id: next, open: on }),
    };
  }

  it("comes in from the side of the rail it lies on, in the fast time", () => {
    const { box, show } = sidebar("tree", true);
    show("search");
    expect(enter).toHaveBeenLastCalledWith(box, {
      from: "end",
      distance: "lg",
      duration: "--dur-fast",
    });
    show("outline");
    expect(enter).toHaveBeenLastCalledWith(
      box,
      expect.objectContaining({ from: "start" }),
    );
    // The gear at the rail's foot is after every tab above it.
    show("settings");
    expect(enter).toHaveBeenLastCalledWith(
      box,
      expect.objectContaining({ from: "end" }),
    );
    expect(enter).toHaveBeenCalledTimes(3);
  });

  it("doesn't move as the sidebar opens, or while it is shut", () => {
    const { show } = sidebar("tree", false);
    // A rail button on a shut sidebar opens it on its tab: one slide.
    show("search", true);
    show("search", true);
    show("outline", false);
    expect(enter).not.toHaveBeenCalled();
  });
});
