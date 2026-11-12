// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { DocTab } from "./doc-tabs";

const ipc = vi.hoisted(() => ({
  takeDetachedTab: vi.fn(),
  takePendingShowHelp: vi.fn(),
  takePendingWindow: vi.fn(),
  currentWindowSession: vi.fn(),
  takeDraftSnapshots: vi.fn(),
  /** Files gone since the last session. */
  gone: new Set<string>(),
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
  drafts: {
    takeDraftSnapshots: ipc.takeDraftSnapshots,
    saveDraftSnapshot: () => Promise.resolve(),
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
  get isIOSApp() {
    return platform.isIOSApp;
  },
}));
vi.mock("./ios-recents", () => ({ lastIOSDocument }));
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
async function restore(restoreCarets = true, launchStartPage = false) {
  // `drained` is module state (one drain per window): a fresh module each.
  vi.resetModules();
  const { useStartupRestore } = await import("./startup-restore");
  let tabs: DocTab[] = [{ ...INITIAL }];
  const openPathInTab = vi.fn(async () => {});
  const openFile = vi.fn(async () => {});
  // As the window's own: the tab takes the file, its editor remounted.
  const replaceTabWithFile = vi.fn(async (id: string, path: string) => {
    tabs = tabs.map((tab) =>
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
        tabs = update(tabs);
      },
      setDraftsRestoredCount: vi.fn(),
      markOnboardingShown: vi.fn(),
      openPathInTab,
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
    tabs: () => tabs,
    openPathInTab,
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
    const { tabs } = await restore(true, true);
    await waitFor(() =>
      expect(tabs()).toEqual([expect.objectContaining({ start: true })]),
    );
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
  it("opens the first document as any file opens, the rest in tabs", async () => {
    ipc.takePendingWindow.mockResolvedValue({ paths: ["/docs/a.md", "/docs/b.md"] });
    const { tabs, openPathInTab, replaceTabWithFile } = await restore();
    await waitFor(() =>
      expect(openPathInTab).toHaveBeenCalledWith("/docs/b.md", {
        restoreCaret: true,
      }),
    );
    expect(replaceTabWithFile).toHaveBeenCalledWith("initial", "/docs/a.md", {
      restoreCaret: true,
    });
    expect(tabs()).toEqual([
      expect.objectContaining({ id: "initial", path: "/docs/a.md" }),
    ]);
  });

  it("skips a first document deleted since, and still opens the rest", async () => {
    ipc.gone.add("/docs/a.md");
    ipc.takePendingWindow.mockResolvedValue({ paths: [
      "/docs/a.md",
      "/docs/b.md",
      "/docs/c.md",
    ] });
    const { tabs, openPathInTab } = await restore();
    await waitFor(() =>
      expect(openPathInTab).toHaveBeenCalledWith("/docs/c.md", {
        restoreCaret: true,
      }),
    );
    expect(tabs()).toEqual([
      expect.objectContaining({ id: "initial", path: "/docs/b.md" }),
    ]);
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
    ipc.takePendingWindow.mockResolvedValue({ paths: [
      "/docs/a.md",
      "/docs/b.md",
      "/docs/c.md",
    ] });
    ipc.takeDraftSnapshots.mockResolvedValue([
      { tabId: "old-a", path: "/docs/a.md", content: "a, unsaved" },
      { tabId: "old-b", path: "/docs/b.md", content: "b, unsaved" },
    ]);
    const { tabs, openPathInTab } = await restore();
    await waitFor(() =>
      expect(openPathInTab).toHaveBeenCalledWith("/docs/c.md", {
        restoreCaret: true,
      }),
    );
    expect(openPathInTab).toHaveBeenCalledTimes(1);
    expect(tabs()).toEqual([
      expect.objectContaining({
        id: "initial",
        path: "/docs/a.md",
        content: "a, unsaved",
        savedContent: "# /docs/a.md\n",
        reloadKey: 1,
      }),
      expect.objectContaining({ path: "/docs/b.md", content: "b, unsaved" }),
    ]);
  });

  // A crash with nothing reopened: what was recovered fills the window, not
  // an empty "Untitled" beside it.
  it("puts the first recovered draft in the initial tab", async () => {
    ipc.takeDraftSnapshots.mockResolvedValue([
      { tabId: "old-a", path: null, content: "draft a" },
      { tabId: "old-b", path: null, content: "draft b" },
    ]);
    const { tabs } = await restore();
    await waitFor(() => expect(tabs()[0].content).toBe("draft a"));
    expect(tabs()).toEqual([
      expect.objectContaining({ id: "initial", content: "draft a" }),
      expect.objectContaining({ content: "draft b" }),
    ]);
  });
});
