// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocTab } from "./doc-tabs";

const ipc = vi.hoisted(() => ({
  takeDetachedTab: vi.fn(),
  takePendingShowHelp: vi.fn(),
  takePendingOpenPaths: vi.fn(),
  takePendingOpenPath: vi.fn(),
  takeDraftSnapshots: vi.fn(),
  takeWorkspaceSnapshots: vi.fn(),
}));

vi.mock("../platform/ipc", () => ({
  windowIpc: {
    takeDetachedTab: ipc.takeDetachedTab,
    takePendingShowHelp: ipc.takePendingShowHelp,
    takePendingOpenPaths: ipc.takePendingOpenPaths,
    takePendingOpenPath: ipc.takePendingOpenPath,
  },
  drafts: { takeDraftSnapshots: ipc.takeDraftSnapshots },
  workspaceDrafts: { takeRecoveries: ipc.takeWorkspaceSnapshots },
}));
// Desktop unless a test says otherwise.
const platform = vi.hoisted(() => ({
  canUseWindows: true,
  hasAppMenu: true,
  isIOSApp: false,
}));
const lastIOSDocument = vi.hoisted(() => vi.fn());
vi.mock("../platform/capabilities", () => ({
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
async function restore(newDocumentMode: "tab" | "window" = "tab") {
  // `drained` is module state (one drain per window): a fresh module each.
  vi.resetModules();
  const { useStartupRestore } = await import("./startup-restore");
  let tabs: DocTab[] = [{ ...INITIAL }];
  const openPathInTab = vi.fn(async () => {});
  const openFile = vi.fn(async () => {});
  renderHook(() =>
    useStartupRestore({
      activeTabId: INITIAL.id,
      enableDraftRecovery: true,
      newDocumentMode,
      language: "en",
      onboardingShown: true,
      setTabs: (update) => {
        tabs = update(tabs);
      },
      setDraftsRestoredCount: vi.fn(),
      markOnboardingShown: vi.fn(),
      openPathInTab,
      openFile,
      startTutorial: vi.fn(),
      stopTutorial: vi.fn(),
    }),
  );
  return { tabs: () => tabs, openPathInTab, openFile };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(platform, {
    canUseWindows: true,
    hasAppMenu: true,
    isIOSApp: false,
  });
  lastIOSDocument.mockResolvedValue(null);
  ipc.takeDetachedTab.mockResolvedValue(null);
  ipc.takePendingShowHelp.mockResolvedValue(null);
  ipc.takePendingOpenPaths.mockResolvedValue([]);
  ipc.takePendingOpenPath.mockResolvedValue(null);
  ipc.takeDraftSnapshots.mockResolvedValue([]);
  ipc.takeWorkspaceSnapshots.mockResolvedValue([]);
});
afterEach(cleanup);

describe("startup restore into the initial tab", () => {
  it("restores a workspace for a saved document without replacing newer disk text", async () => {
    ipc.takeWorkspaceSnapshots.mockResolvedValue([
      {
        documentId: "workspace-1",
        documentPath: "/docs/a.md",
        draft: { baseMarkdown: "Old base." },
      },
    ]);
    const { tabs } = await restore();
    await waitFor(() => expect(tabs()[0].workspaceId).toBe("workspace-1"));
    expect(tabs()[0].content).toBe("# /docs/a.md\n");
    expect(tabs()[0].savedContent).toBe("# /docs/a.md\n");
  });

  it("merges workspace recovery with a newer unsaved document snapshot", async () => {
    ipc.takeDraftSnapshots.mockResolvedValue([
      { tabId: "new-tab", path: null, content: "Manual edits." },
    ]);
    ipc.takeWorkspaceSnapshots.mockResolvedValue([
      {
        documentId: "workspace-1",
        tabId: "new-tab",
        documentPath: null,
        draft: { baseMarkdown: "Old base." },
      },
    ]);
    const { tabs } = await restore();
    await waitFor(() => expect(tabs()[0].workspaceId).toBe("workspace-1"));
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0].content).toBe("Manual edits.");
  });
  // The initial tab's editor can mount before the restore's IPC round trips
  // finish, and reads its content only at mount: whatever lands in that tab
  // must move reloadKey on, or the editor keeps showing an empty document
  // over the file the tab now holds.
  it("remounts the initial tab's editor on the first restored document", async () => {
    ipc.takePendingOpenPaths.mockResolvedValue(["/docs/a.md", "/docs/b.md"]);
    const { tabs, openPathInTab } = await restore("tab");
    await waitFor(() =>
      expect(openPathInTab).toHaveBeenCalledWith("/docs/b.md"),
    );
    expect(tabs()).toEqual([
      expect.objectContaining({
        id: "initial",
        path: "/docs/a.md",
        content: "# /docs/a.md\n",
        savedContent: "# /docs/a.md\n",
        reloadKey: 1,
      }),
    ]);
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

  // After a crash the session reopens the files that were open, and the
  // drafts hold their unsaved edits: each document must open once, edits
  // and all, not as a saved tab beside a recovered copy.
  it("opens a reopened session file once, with its recovered edits", async () => {
    ipc.takePendingOpenPaths.mockResolvedValue([
      "/docs/a.md",
      "/docs/b.md",
      "/docs/c.md",
    ]);
    ipc.takeDraftSnapshots.mockResolvedValue([
      { tabId: "old-a", path: "/docs/a.md", content: "a, unsaved" },
      { tabId: "old-b", path: "/docs/b.md", content: "b, unsaved" },
    ]);
    const { tabs, openPathInTab } = await restore("tab");
    await waitFor(() =>
      expect(openPathInTab).toHaveBeenCalledWith("/docs/c.md"),
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

  it("and so does a window opened for one file", async () => {
    ipc.takePendingOpenPath.mockResolvedValue("/docs/a.md");
    ipc.takeDraftSnapshots.mockResolvedValue([
      { tabId: "old-a", path: "/docs/a.md", content: "a, unsaved" },
    ]);
    const { tabs, openFile } = await restore("window");
    await waitFor(() => expect(tabs()[0].path).toBe("/docs/a.md"));
    expect(openFile).not.toHaveBeenCalled();
    expect(tabs()).toEqual([
      expect.objectContaining({ id: "initial", content: "a, unsaved" }),
    ]);
  });

  // A crash with nothing reopened: what was recovered fills the window, not
  // an empty "Untitled" beside it.
  it("puts the first recovered draft in the initial tab", async () => {
    ipc.takeDraftSnapshots.mockResolvedValue([
      { tabId: "old-a", path: null, content: "draft a" },
      { tabId: "old-b", path: null, content: "draft b" },
    ]);
    const { tabs } = await restore("tab");
    await waitFor(() => expect(tabs()[0].content).toBe("draft a"));
    expect(tabs()).toEqual([
      expect.objectContaining({ id: "initial", content: "draft a" }),
      expect.objectContaining({ content: "draft b" }),
    ]);
  });

  it("leaves the initial tab alone when nothing claims it", async () => {
    const { tabs, openFile } = await restore("window");
    await waitFor(() => expect(ipc.takePendingOpenPath).toHaveBeenCalled());
    expect(openFile).not.toHaveBeenCalled();
    expect(tabs()).toEqual([INITIAL]);
  });
});
