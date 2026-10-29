// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { DocTab } from "./doc-tabs";
import { installTestLocalStorage } from "../dev/test-local-storage";

const ipc = vi.hoisted(() => ({
  takeDetachedTab: vi.fn(),
  takePendingShowHelp: vi.fn(),
  takePendingOpenPaths: vi.fn(),
  takePendingWindowPaths: vi.fn(),
  takeDraftSnapshots: vi.fn(),
}));

vi.mock("../platform/ipc", () => ({
  windowIpc: {
    takeDetachedTab: ipc.takeDetachedTab,
    takePendingShowHelp: ipc.takePendingShowHelp,
    takePendingOpenPaths: ipc.takePendingOpenPaths,
    takePendingWindowPaths: ipc.takePendingWindowPaths,
  },
  drafts: { takeDraftSnapshots: ipc.takeDraftSnapshots },
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
async function restore(
  newDocumentMode: "tab" | "window" = "tab",
  restoreCarets = true,
) {
  // `drained` is module state (one drain per window): a fresh module each.
  vi.resetModules();
  const { useStartupRestore } = await import("./startup-restore");
  let tabs: DocTab[] = [{ ...INITIAL }];
  const openPathInTab = vi.fn(async () => {});
  const openFile = vi.fn(async () => {});
  const replaceTabWithFile = vi.fn(async () => {});
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
      replaceTabWithFile,
      restoreCarets,
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
  Object.assign(platform, {
    canUseWindows: true,
    hasAppMenu: true,
    isIOSApp: false,
  });
  lastIOSDocument.mockResolvedValue(null);
  ipc.takeDetachedTab.mockResolvedValue(null);
  ipc.takePendingShowHelp.mockResolvedValue(null);
  ipc.takePendingOpenPaths.mockResolvedValue([]);
  ipc.takePendingWindowPaths.mockResolvedValue([]);
  ipc.takeDraftSnapshots.mockResolvedValue([]);
});
afterEach(cleanup);

describe("startup restore into the initial tab", () => {
  // The initial tab's editor can mount before the restore finishes and reads
  // its content only at mount, so reloadKey must move.
  it("remounts the initial tab's editor on the first restored document", async () => {
    ipc.takePendingOpenPaths.mockResolvedValue(["/docs/a.md", "/docs/b.md"]);
    const { tabs, openPathInTab } = await restore("tab");
    await waitFor(() =>
      expect(openPathInTab).toHaveBeenCalledWith("/docs/b.md", {
        restoreCaret: true,
      }),
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

  it("converts a Word document handed over at launch into the initial tab", async () => {
    ipc.takePendingOpenPaths.mockResolvedValue(["/docs/Report.docx"]);
    const { tabs, replaceTabWithFile, openPathInTab } = await restore("tab");
    await waitFor(() =>
      expect(replaceTabWithFile).toHaveBeenCalledWith(
        "initial",
        "/docs/Report.docx",
      ),
    );
    expect(openPathInTab).not.toHaveBeenCalled();
    expect(tabs()[0].path).toBeNull();
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

  it("and so does a window opened for one file", async () => {
    ipc.takePendingWindowPaths.mockResolvedValue(["/docs/a.md"]);
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

  it("brings a window back with each of its tabs", async () => {
    ipc.takePendingWindowPaths.mockResolvedValue(["/docs/a.md", "/docs/b.md"]);
    const { openFile, openPathInTab } = await restore("window");
    await waitFor(() =>
      expect(openPathInTab).toHaveBeenCalledWith("/docs/b.md", {
        restoreCaret: true,
      }),
    );
    expect(openFile).toHaveBeenCalledWith("/docs/a.md", { restoreCaret: true });
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
    await waitFor(() => expect(ipc.takePendingWindowPaths).toHaveBeenCalled());
    expect(openFile).not.toHaveBeenCalled();
    expect(tabs()).toEqual([INITIAL]);
  });

  describe("at the last caret", () => {
    beforeAll(installTestLocalStorage);
    beforeEach(() =>
      localStorage.setItem(
        "textus-last-carets",
        JSON.stringify({
          "/docs/a.md": { offset: 3, mtime: 1 },
          "/docs/b.md": { offset: 9, mtime: 2 },
        }),
      ),
    );
    afterEach(() => localStorage.removeItem("textus-last-carets"));

    it("hands the initial tab's editor the caret its file was left at", async () => {
      ipc.takePendingOpenPaths.mockResolvedValue(["/docs/a.md"]);
      const { tabs, takeTabJump } = await restore("tab");
      await waitFor(() => expect(tabs()[0].path).toBe("/docs/a.md"));
      expect(takeTabJump("initial")).toEqual({
        kind: "caret",
        at: { offset: 3 },
      });
    });

    it("opens a file changed since at its top", async () => {
      // b.md was left at mtime 2; the disk now says 1.
      ipc.takePendingOpenPaths.mockResolvedValue(["/docs/b.md"]);
      const { tabs, takeTabJump } = await restore("tab");
      await waitFor(() => expect(tabs()[0].path).toBe("/docs/b.md"));
      expect(takeTabJump("initial")).toBeNull();
    });

    it("restores nothing with Restore Previous Session off", async () => {
      ipc.takePendingOpenPaths.mockResolvedValue(["/docs/a.md"]);
      const { tabs, takeTabJump } = await restore("tab", false);
      await waitFor(() => expect(tabs()[0].path).toBe("/docs/a.md"));
      expect(takeTabJump("initial")).toBeNull();
    });

    it("asks the same for a window opened for one file", async () => {
      ipc.takePendingWindowPaths.mockResolvedValue(["/docs/a.md"]);
      const { openFile } = await restore("window");
      await waitFor(() =>
        expect(openFile).toHaveBeenCalledWith("/docs/a.md", {
          restoreCaret: true,
        }),
      );
    });
  });
});
