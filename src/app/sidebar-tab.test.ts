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
    storeSidebarTab("clipboard");
    expect(storedSidebarTab()).toBe("clipboard");
  });

  it("is Files when the stored tab is one this build doesn't have", () => {
    localStorage.setItem(KEY, "graph");
    expect(storedSidebarTab()).toBe("tree");
    localStorage.setItem(KEY, "");
    expect(storedSidebarTab()).toBe("tree");
  });
});
