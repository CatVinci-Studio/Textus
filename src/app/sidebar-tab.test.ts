// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installTestLocalStorage } from "../dev/test-local-storage";
import { storeSidebarTab, storedSidebarTab } from "./sidebar-tab";

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
