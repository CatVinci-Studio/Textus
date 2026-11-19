// @vitest-environment jsdom
import { readDocFromDisk } from "./doc-tabs";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocTab } from "./doc-tabs";

const ipc = vi.hoisted(() => ({
  takeDetachedTab: vi.fn(),
  takePendingShowHelp: vi.fn(),
  takePendingWindow: vi.fn(),
  currentWindowSession: vi.fn(),
  takeDraftSnapshots: vi.fn(),
  /** Files gone since the last session. */
  gone: new Set<string>(),
  saveDraftSnapshot: vi.fn(() => Promise.resolve()),
  clearDraftSnapshot: vi.fn(() => Promise.resolve()),
}));

vi.mock("../platform/ipc", () => ({
  windowIpc: {
    takeDetachedTab: ipc.takeDetachedTab,
    takePendingShowHelp: ipc.takePendingShowHelp,
    takePendingWindow: ipc.takePendingWindow,
    currentWindowSession: ipc.currentWindowSession,
  },
  fs: {
    fileMtimeMs: async (path: string) => (ipc.gone.has(path) ? null : 1),
  },
  session: { addRecentFile: async () => {} },
  drafts: {
    takeDraftSnapshots: ipc.takeDraftSnapshots,
    saveDraftSnapshot: ipc.saveDraftSnapshot,
    clearDraftSnapshot: ipc.clearDraftSnapshot,
    finishDraftRestore: () => Promise.resolve(),
  },
}));
// Desktop unless a test says otherwise.
const platform = vi.hoisted(() => ({
  canUseWindows: true,
  hasAppMenu: true,
  isIOSApp: false,
}));
const lastIOSDocument = vi.hoisted(() => vi.fn());
vi.mock("../platform/capabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../platform/capabilities")>()),
  get canUseWindows() {
    return platform.canUseWindows;
  },
  get hasAppMenu() {
    return platform.hasAppMenu;
  },
  get isMobileApp() {
    return platform.isIOSApp;
  },
}));
vi.mock("./ios-recents", () => ({ lastIOSDocument }));
// A database plugin opens .base files.
vi.mock("../plugins/manager", () => ({ loadPlugins: async () => {} }));
vi.mock("../plugins/store/plugin-lookup", () => ({
  customEditorFor: (path: string) =>
    path.endsWith(".base")
      ? { plugin: "db", viewType: "db.table", title: "all.base" }
      : null,
  customEditorForContent: () => null,
}));
vi.mock("./doc-tabs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./doc-tabs")>()),
  readDocFromDisk: vi.fn(async (path: string) => ({
    content: `# ${path}\n`,
    diskMtime: 1,
  })),
}));

const INITIAL: DocTab = {
  id: "initial",
  path: null,
  content: "",
  savedContent: "",
  diskMtime: null,
  sourceMode: false,
  reloadKey: 0,
};

/** Runs the hook against a tab list held here, the way App holds it. */
async function restore(
  restoreCarets = true,
  launchStartPage = false,
  /** Tabs held in the window's own model, which orders them by island. */
  inModel = false,
  /** Done while the session's documents are read. */
  meanwhile?: (tabs: DocTab[]) => DocTab[],
  /** Tabs the window already has before the initial one (the AI's). */
  before: DocTab[] = [],
) {
  // `drained` is module state (one drain per window): a fresh module each.
  vi.resetModules();
  const { useStartupRestore } = await import("./startup-restore");
  const model = await import("../engine/layout/store");
  let local: DocTab[] = [...before, { ...INITIAL }];
  if (inModel)
    model.startWindowTabs(local, () => ({ ...INITIAL, id: "blank" }));
  const held = {
    get tabs(): DocTab[] {
      return inModel ? [...model.windowTabs<DocTab>()] : local;
    },
    set tabs(next: DocTab[]) {
      if (inModel) model.setWindowTabs<DocTab>(() => next);
      else local = next;
    },
  };
  const openPathInTab = vi.fn(async () => {});
  // Made into tabs, not added: the restore adds them in one update.
  const tabsForPaths = vi.fn(async (paths: string[]) => {
    if (meanwhile) held.tabs = meanwhile(held.tabs);
    return paths.map((path) => ({ ...INITIAL, id: `tab:${path}`, path }));
  });
  const openFile = vi.fn(async () => {});
  // As the window's own: the tab takes the file, its editor remounted.
  const replaceTabWithFile = vi.fn(async (id: string, path: string) => {
    held.tabs = held.tabs.map((tab) =>
      tab.id === id ? { ...tab, path, reloadKey: tab.reloadKey + 1 } : tab,
    );
  });
  renderHook(() =>
    useStartupRestore({
      activeTabId: INITIAL.id,
      enableDraftRecovery: true,
      language: "en",
      onboardingShown: true,
      setTabs: (update) => {
        held.tabs = update(held.tabs);
      },
      setDraftsRestoredCount: vi.fn(),
      markOnboardingShown: vi.fn(),
      openPathInTab,
      tabsForPaths,
      openFile,
      replaceTabWithFile,
      restoreCarets,
      launchStartPage,
      startTutorial: vi.fn(),
      stopTutorial: vi.fn(),
    }),
  );
  const { takeTabJump } = await import("../editor/tab-jump");
  return {
    tabs: () => held.tabs,
    openPathInTab,
    tabsForPaths,
    openFile,
    replaceTabWithFile,
    takeTabJump,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Each test a new window, not a reload of the last.
  sessionStorage.clear();
  Object.assign(platform, {
    canUseWindows: true,
    hasAppMenu: true,
    isIOSApp: false,
  });
  lastIOSDocument.mockResolvedValue(null);
  ipc.takeDetachedTab.mockResolvedValue(null);
  ipc.takePendingShowHelp.mockResolvedValue(null);
  ipc.takePendingWindow.mockResolvedValue(null);
  ipc.takeDraftSnapshots.mockResolvedValue([]);
});
afterEach(cleanup);

describe("startup restore into the initial tab", () => {
  it("shows the start page in a window nothing opens in, when chosen", async () => {
    // The last window's tab order, kept as it closed (Cmd+Q): a phone's
    // way back, not a desktop's.
    localStorage.setItem(
      "textus-tab-order",
      JSON.stringify({ keys: ["path:/docs/a.md"], active: "path:/docs/a.md" }),
    );
    const { tabs } = await restore(true, true);
    await waitFor(() =>
      expect(tabs()).toEqual([expect.objectContaining({ start: true })]),
    );
    localStorage.clear();
  });

  it("a reloaded page comes back to the window's own session, not nothing", async () => {
    sessionStorage.setItem("textus-window-started", "1");
    ipc.currentWindowSession.mockResolvedValue({ paths: ["/docs/a.md"] });
    const { tabs } = await restore(true, true);
    await waitFor(() =>
      expect(tabs()).toEqual([expect.objectContaining({ path: "/docs/a.md" })]),
    );
    expect(ipc.takePendingWindow).not.toHaveBeenCalled();
  });

  it("a reloaded page keeps its plugin tabs, and its drafts under the new tabs only", async () => {
    const view = { plugin: "pdf", view: "reader", kind: "view" } as const;
    sessionStorage.setItem(
      "textus-reload-tabs",
      JSON.stringify({
        active: 0,
        tabs: [
          {
            id: "old-draft",
            path: null,
            text: { content: "typed", savedContent: "", diskMtime: 7 },
          },
          { id: "old-pdf", path: null, view },
        ],
      }),
    );
    const { tabs } = await restore(true, true);
    await waitFor(() =>
      expect(tabs()).toEqual([
        expect.objectContaining({ content: "typed" }),
        expect.objectContaining({ view }),
      ]),
    );
    await waitFor(() =>
      expect(ipc.clearDraftSnapshot).toHaveBeenCalledWith("old-draft"),
    );
    expect(ipc.saveDraftSnapshot).toHaveBeenCalledWith(
      tabs()[0].id,
      null,
      "typed",
      7,
    );
    expect(ipc.clearDraftSnapshot).toHaveBeenCalledWith("old-pdf");

    // A draft whose new copy can't be written keeps its old one.
    ipc.clearDraftSnapshot.mockClear();
    ipc.saveDraftSnapshot.mockRejectedValueOnce(new Error("disk full"));
    const { moveDrafts } = await import("./startup-restore");
    await moveDrafts(
      [
        {
          id: "old-a",
          path: null,
          text: { content: "a", savedContent: "", diskMtime: null },
        },
        {
          id: "old-b",
          path: null,
          text: { content: "b", savedContent: "", diskMtime: null },
        },
      ],
      (i) => `new-${i}`,
    );
    expect(ipc.clearDraftSnapshot.mock.calls).toEqual([["old-b"]]);
  });

  it("but not over a document opened at launch", async () => {
    ipc.takePendingWindow.mockResolvedValue({ paths: ["/docs/a.md"] });
    const { tabs } = await restore(true, true);
    await waitFor(() =>
      expect(tabs()).toEqual([expect.objectContaining({ path: "/docs/a.md" })]),
    );
    expect(tabs()[0].start).toBeUndefined();
  });

  // Opened as any file is (a board a plugin claims, a Word document, the
  // recent list, its last caret), into the initial tab.
  it("opens the first document as any file opens, the rest behind it at once", async () => {
    ipc.takePendingWindow.mockResolvedValue({
      paths: ["/docs/a.md", "/docs/b.md", "/docs/c.md"],
    });
    const { tabs, openPathInTab, tabsForPaths, replaceTabWithFile } =
      await restore();
    await waitFor(() => expect(tabs()).toHaveLength(3));
    expect(replaceTabWithFile).toHaveBeenCalledWith(
      "initial",
      "/docs/a.md",
      expect.objectContaining({
        restoreCaret: true,
      }),
    );
    expect(tabsForPaths).toHaveBeenCalledWith(
      ["/docs/b.md", "/docs/c.md"],
      expect.any(Boolean),
    );
    // None is brought to the front one by one.
    expect(openPathInTab).not.toHaveBeenCalled();
    expect(tabs().map((tab) => tab.path)).toEqual([
      "/docs/a.md",
      "/docs/b.md",
      "/docs/c.md",
    ]);
  });

  it("opens the document that was in front first, the tabs in their order", async () => {
    ipc.takePendingWindow.mockResolvedValue({
      paths: ["/docs/a.md", "/docs/b.md", "/docs/c.md"],
      layout: {
        tree: {
          paths: ["/docs/a.md", "/docs/b.md", "/docs/c.md"],
          front: "/docs/b.md",
        },
      },
    });
    const { tabs, replaceTabWithFile } = await restore();
    await waitFor(() => expect(tabs()).toHaveLength(3));
    // A saved session: opened as last time, no plugin offered.
    expect(replaceTabWithFile).toHaveBeenCalledWith("initial", "/docs/b.md", {
      restoreCaret: true,
      reopening: true,
    });
    expect(tabs().map((tab) => [tab.id, tab.path])).toEqual([
      ["tab:/docs/a.md", "/docs/a.md"],
      ["initial", "/docs/b.md"],
      ["tab:/docs/c.md", "/docs/c.md"],
    ]);
  });

  it("brings a draft that was in front back in front, the files behind it", async () => {
    localStorage.setItem(
      "textus-tab-order",
      JSON.stringify({ keys: ["path:/docs/a.md", "id:d1"], active: "id:d1" }),
    );
    ipc.takeDraftSnapshots.mockResolvedValue([
      { tabId: "d1", path: null, content: "draft text", diskMtime: null },
    ]);
    ipc.takePendingWindow.mockResolvedValue({
      paths: ["/docs/a.md"],
      layout: { tree: { paths: ["/docs/a.md"], front: "/docs/a.md" } },
    });
    await restore(true, false, true);
    const model = await import("../engine/layout/store");
    await waitFor(() =>
      expect(
        model.windowTabs<DocTab>().find((tab) => tab.id === model.tabInUse())
          ?.content,
      ).toBe("draft text"),
    );
    localStorage.removeItem("textus-tab-order");
  });

  it("keeps that order in the window's own model, which orders by island", async () => {
    ipc.takePendingWindow.mockResolvedValue({
      paths: ["/docs/a.md", "/docs/b.md", "/docs/c.md"],
      layout: {
        tree: {
          paths: ["/docs/a.md", "/docs/b.md", "/docs/c.md"],
          front: "/docs/b.md",
        },
      },
    });
    const { tabs } = await restore(true, false, true);
    await waitFor(() => expect(tabs()).toHaveLength(3));
    expect(tabs().map((tab) => tab.path)).toEqual([
      "/docs/a.md",
      "/docs/b.md",
      "/docs/c.md",
    ]);
  });

  it("a reloaded page keeps the tab in front at its place in the row", async () => {
    sessionStorage.setItem(
      "textus-reload-tabs",
      JSON.stringify({
        active: 2,
        tabs: ["/docs/a.md", "/docs/b.md", "/docs/c.md", "/docs/d.md"].map(
          (path, i) => ({ id: `old-${i}`, path }),
        ),
      }),
    );
    const { tabs } = await restore(true, false, true);
    await waitFor(() => expect(tabs()).toHaveLength(4));
    expect(tabs().map((tab) => tab.path)).toEqual([
      "/docs/a.md",
      "/docs/b.md",
      "/docs/c.md",
      "/docs/d.md",
    ]);
  });

  it("doesn't open twice a session file the user opened meanwhile", async () => {
    ipc.takePendingWindow.mockResolvedValue({
      paths: ["/docs/a.md", "/docs/b.md"],
    });
    // Clicked in the tree while the batch was read.
    const { tabs } = await restore(true, false, false, (now) => [
      ...now,
      { ...INITIAL, id: "clicked", path: "/docs/b.md" },
    ]);
    await waitFor(() =>
      expect(tabs().map((tab) => tab.id)).toEqual(["initial", "clicked"]),
    );
  });

  it("skips a first document deleted since, and still opens the rest", async () => {
    ipc.gone.add("/docs/a.md");
    ipc.takePendingWindow.mockResolvedValue({
      paths: ["/docs/a.md", "/docs/b.md", "/docs/c.md"],
    });
    const { tabs, tabsForPaths } = await restore();
    await waitFor(() => expect(tabs()).toHaveLength(2));
    expect(tabsForPaths).toHaveBeenCalledWith(
      ["/docs/c.md"],
      expect.any(Boolean),
    );
    expect(tabs()[0]).toEqual(
      expect.objectContaining({ id: "initial", path: "/docs/b.md" }),
    );
    ipc.gone.clear();
  });

  it("leaves the blank tab when the last document is gone too", async () => {
    ipc.gone.add("/docs/a.md");
    ipc.takePendingWindow.mockResolvedValue({ paths: ["/docs/a.md"] });
    const { tabs, replaceTabWithFile } = await restore();
    await waitFor(() => expect(ipc.takeDraftSnapshots).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(replaceTabWithFile).not.toHaveBeenCalled();
    expect(tabs()[0].path).toBeNull();
    ipc.gone.clear();
  });

  it("does the same for a tab dragged in from another window", async () => {
    ipc.takeDetachedTab.mockResolvedValue({
      path: "/docs/dragged.md",
      content: "dragged, with edits",
      savedContent: "dragged",
      diskMtime: 5,
    });
    const { tabs } = await restore();
    await waitFor(() => expect(tabs()[0].path).toBe("/docs/dragged.md"));
    expect(tabs()[0]).toMatchObject({
      content: "dragged, with edits",
      savedContent: "dragged",
      reloadKey: 1,
    });
  });

  it("and for a guide this window was opened to show", async () => {
    ipc.takePendingShowHelp.mockResolvedValue("markdown");
    const { tabs } = await restore();
    await waitFor(() => expect(tabs()[0].helpDoc).toBe("markdown"));
    expect(tabs()[0].content).not.toBe("");
    expect(tabs()[0].reloadKey).toBe(1);
  });

  it("and for the document an iPhone had open last time", async () => {
    Object.assign(platform, {
      canUseWindows: false,
      hasAppMenu: false,
      isIOSApp: true,
    });
    lastIOSDocument.mockResolvedValue("/docs/last.md");
    const { tabs } = await restore();
    await waitFor(() => expect(tabs()[0].path).toBe("/docs/last.md"));
    expect(tabs()).toEqual([
      expect.objectContaining({
        id: "initial",
        content: "# /docs/last.md\n",
        savedContent: "# /docs/last.md\n",
        reloadKey: 1,
      }),
    ]);
  });

  it("on a phone ended in the background: its saved documents, drafts and the AI's tab in their order, the one in front in front", async () => {
    Object.assign(platform, {
      canUseWindows: false,
      hasAppMenu: false,
      isIOSApp: true,
    });
    lastIOSDocument.mockResolvedValue("/docs/b.md");
    localStorage.setItem(
      "textus-tab-order",
      JSON.stringify({
        keys: ["path:/docs/a.md", "view:ai", "id:old-d", "path:/docs/b.md"],
        active: "path:/docs/a.md",
      }),
    );
    ipc.takeDraftSnapshots.mockResolvedValue([
      { tabId: "old-d", path: null, content: "draft d" },
    ]);
    const ai = {
      ...INITIAL,
      id: "ai",
      view: { plugin: "textus", view: "ai", kind: "page" as const },
    };
    const { tabs } = await restore(true, false, true, undefined, [ai]);
    await waitFor(() =>
      expect(
        tabs().map((tab) => tab.path ?? tab.view?.view ?? tab.content),
      ).toEqual(["/docs/a.md", "ai", "draft d", "/docs/b.md"]),
    );
    expect(tabs()[0].id).toBe("initial");
    localStorage.clear();
  });

  it("and for that document's recovered edits, which take the initial tab's place", async () => {
    Object.assign(platform, {
      canUseWindows: false,
      hasAppMenu: false,
      isIOSApp: true,
    });
    lastIOSDocument.mockResolvedValue("/docs/last.md");
    ipc.takeDraftSnapshots.mockResolvedValue([
      { tabId: "old", path: "/docs/last.md", content: "unsaved edits" },
    ]);
    const { tabs } = await restore();
    await waitFor(() => expect(tabs()[0].path).toBe("/docs/last.md"));
    // One tab, not the saved document beside its recovered copy.
    expect(tabs()).toEqual([
      expect.objectContaining({
        id: "initial",
        content: "unsaved edits",
        savedContent: "# /docs/last.md\n",
        reloadKey: 1,
      }),
    ]);
  });

  // After a crash, each reopened document opens once, with its recovered
  // edits.
  it("opens a reopened session file once, with its recovered edits", async () => {
    ipc.takePendingWindow.mockResolvedValue({
      paths: ["/docs/a.md", "/docs/b.md", "/docs/c.md"],
    });
    ipc.takeDraftSnapshots.mockResolvedValue([
      { tabId: "old-a", path: "/docs/a.md", content: "a, unsaved" },
      // Begun from an older copy of b: saving it asks first.
      {
        tabId: "old-b",
        path: "/docs/b.md",
        content: "b, unsaved",
        diskMtime: 5,
      },
    ]);
    const { tabs, tabsForPaths } = await restore();
    await waitFor(() => expect(tabs()).toHaveLength(3));
    expect(tabsForPaths).toHaveBeenCalledWith(
      ["/docs/c.md"],
      expect.any(Boolean),
    );
    expect(tabs()).toEqual([
      expect.objectContaining({
        id: "initial",
        path: "/docs/a.md",
        content: "a, unsaved",
        savedContent: "# /docs/a.md\n",
        reloadKey: 1,
      }),
      expect.objectContaining({
        path: "/docs/b.md",
        content: "b, unsaved",
        diskMtime: 5,
      }),
      expect.objectContaining({ path: "/docs/c.md" }),
    ]);
  });

  // A crash with nothing reopened: what was recovered fills the window, not
  // an empty "Untitled" beside it.
  it("puts the first recovered draft in the initial tab", async () => {
    // b's file is gone (a drive not mounted): its edits come back untitled.
    vi.mocked(readDocFromDisk).mockRejectedValueOnce(new Error("gone"));
    ipc.takeDraftSnapshots.mockResolvedValue([
      { tabId: "old-a", path: null, content: "draft a" },
      { tabId: "old-b", path: "/gone/b.md", content: "draft b" },
    ]);
    const { tabs } = await restore();
    await waitFor(() => expect(tabs()[0].content).toBe("draft a"));
    expect(tabs()).toEqual([
      expect.objectContaining({ id: "initial", content: "draft a" }),
      expect.objectContaining({ content: "draft b", path: null }),
    ]);
  });

  // Android ended the app in the background: no window session, only the
  // drafts and the order its tabs were in.
  it("brings the drafts back in their tabs' order, the front one in front, kept once", async () => {
    localStorage.setItem(
      "textus-tab-order",
      JSON.stringify({ ids: ["old-b", "old-c", "old-a"], active: "old-c" }),
    );
    ipc.takeDraftSnapshots.mockResolvedValue(
      ["a", "b", "c"].map((x) => ({
        tabId: `old-${x}`,
        path: null,
        content: `draft ${x}`,
      })),
    );
    // The AI's tab first in the row: the drafts keep their order after it.
    const ai = { ...INITIAL, id: "ai", content: "ai" };
    const { tabs } = await restore(true, false, true, undefined, [ai]);
    await waitFor(() =>
      expect(tabs().map((tab) => tab.content)).toEqual([
        "ai",
        "draft b",
        "draft c",
        "draft a",
      ]),
    );
    expect(tabs()[2].id).toBe("initial");
    // c's draft, kept again under the tab it came in as, goes once it is
    // kept under the initial one: the next launch finds it once.
    await waitFor(() => expect(ipc.clearDraftSnapshot).toHaveBeenCalled());
    const resavedAs = (
      ipc.saveDraftSnapshot.mock.calls as unknown as [string, unknown, string][]
    )
      .filter((call) => call[2] === "draft c")
      .map((call) => call[0]);
    expect(resavedAs).toContain("initial");
    expect(ipc.clearDraftSnapshot).toHaveBeenCalledWith(
      resavedAs.find((id) => id !== "initial"),
    );
    localStorage.clear();
  });
  it("and a file a plugin showed in front comes back in front, the plugin's tab again", async () => {
    Object.assign(platform, {
      canUseWindows: false,
      hasAppMenu: false,
      isIOSApp: true,
    });
    const last = lastIOSDocument.getMockImplementation();
    lastIOSDocument.mockResolvedValue(null);
    localStorage.setItem(
      "textus-tab-order",
      JSON.stringify({
        keys: ["path:/docs/a.md", "path:/docs/all.base"],
        active: "path:/docs/all.base",
      }),
    );
    const { tabs } = await restore();
    await waitFor(() =>
      expect(tabs().find((tab) => tab.id === "initial")).toMatchObject({
        path: null,
        view: { plugin: "db", kind: "editor", resource: "/docs/all.base" },
      }),
    );
    expect(tabs().map((tab) => tab.path ?? tab.view?.resource)).toEqual([
      "/docs/a.md",
      "/docs/all.base",
    ]);
    localStorage.clear();
    lastIOSDocument.mockImplementation(last ?? (async () => null));
  });
});
