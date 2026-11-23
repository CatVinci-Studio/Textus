// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const START_PAGE = {
  onboardingShown: true,
  startPageOnLaunch: true,
  restoreSessionOnStartup: false,
};
// The settings as the window has them (settings-store reads its boot's).
vi.mock("../prefs/settings-store", () => ({ loadSettings: () => START_PAGE }));

/** A fresh window, its boot snapshot as Rust made it. */
async function windowWith(boot: Record<string, unknown>, reload = false) {
  vi.resetModules();
  sessionStorage.clear();
  if (reload) sessionStorage.setItem("textus-window-started", "1");
  (window as Window & { __BOOT__?: unknown }).__BOOT__ = {
    rev: 1,
    label: "window-2",
    uiState: {},
    settings: {},
    restoring: false,
    detachedTab: null,
    ...boot,
  };
  return {
    ...(await import("./first-tab")),
    ...(await import("./reload-tabs")),
  };
}

const DRAGGED = {
  path: "/docs/dragged.md",
  content: "dragged, with edits",
  savedContent: "dragged",
  diskMtime: 5,
};
const restoring = () => "restoring" in document.documentElement.dataset;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  delete document.documentElement.dataset.restoring;
});

describe("a window's first tab", () => {
  it("is the start page from the first frame when nothing will open", async () => {
    const { firstTab } = await windowWith({});
    expect(firstTab()).toMatchObject({ start: true, path: null });
  });

  it("is a blank document while something may open in it", async () => {
    const { firstTab } = await windowWith({ restoring: true });
    expect(firstTab().start).toBeFalsy();
  });

  it("is the tab dragged out into it, handed over in the boot snapshot", async () => {
    const { firstTab } = await windowWith({
      restoring: true,
      detachedTab: DRAGGED,
    });
    expect(firstTab()).toMatchObject({ ...DRAGGED, reloadKey: 0 });
  });

  it("isn't that tab again on a reload, which replays the snapshot", async () => {
    const { firstTab } = await windowWith(
      { restoring: true, detachedTab: DRAGGED },
      true,
    );
    expect(firstTab().path).toBeNull();
  });
});

describe("the sheets held back while the window restores", () => {
  it("show once the restore has opened what it opens", async () => {
    const { holdSheetsWhileRestoring, keptTabsRestored } = await windowWith({
      restoring: true,
    });
    holdSheetsWhileRestoring();
    expect(restoring()).toBe(true);
    keptTabsRestored();
    expect(restoring()).toBe(false);
  });

  it("show after a second at most", async () => {
    const { holdSheetsWhileRestoring } = await windowWith({ restoring: true });
    holdSheetsWhileRestoring();
    vi.advanceTimersByTime(999);
    expect(restoring()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(restoring()).toBe(false);
  });

  it("aren't held with nothing to restore, nor for a tab already there", async () => {
    let window = await windowWith({});
    window.holdSheetsWhileRestoring();
    expect(restoring()).toBe(false);
    window = await windowWith({ restoring: true, detachedTab: DRAGGED });
    window.holdSheetsWhileRestoring();
    expect(restoring()).toBe(false);
  });
});
