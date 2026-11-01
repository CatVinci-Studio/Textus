// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSaveTabs } from "./useSaveTabs";
import { useTabState } from "./tabs/useTabState";
import { fs } from "../platform/ipc";
import { documentsDir } from "../platform/documents-path";
import { showConfirm, showMessage } from "../ui/app-dialog";
import en from "../i18n/locales/en";
import type { DocTab } from "../document/doc-tabs";
import type { Strings } from "../i18n/strings";

vi.mock("../platform/ipc", () => ({
  fs: {
    fileMtimeMs: vi.fn(),
    readTextFile: vi.fn(),
    writeTextFile: vi.fn(),
    saveFileDialog: vi.fn(),
    migrateDraftImages: vi.fn(),
  },
  session: { addRecentFile: vi.fn() },
}));
vi.mock("../platform/documents-path", () => ({
  documentsDir: vi.fn(),
}));
vi.mock("../ui/app-dialog", () => ({
  showConfirm: vi.fn(),
  showMessage: vi.fn(),
}));

const doc: DocTab = {
  id: "a",
  path: "/notes/a.md",
  content: "edited\nline",
  savedContent: "original",
  diskMtime: 1,
  sourceMode: false,
  reloadKey: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fs.readTextFile).mockResolvedValue("original\r\n");
  vi.mocked(fs.writeTextFile).mockResolvedValue(undefined);
});
afterEach(cleanup);

function setup(tab: DocTab, folder: string | null = null) {
  const { result } = renderHook(() => {
    const tabState = useTabState();
    const saves = useSaveTabs({
      tabState,
      t: en as Strings,
      autoSuggestFilename: true,
      imageFolder: "assets",
      folder,
    });
    return { tabState, ...saves };
  });
  act(() => {
    result.current.tabState.setTabs([tab]);
  });
  return result;
}

describe("autosaveTab", () => {
  it("writes through File > Save's writer and marks the tab saved", async () => {
    vi.mocked(fs.fileMtimeMs).mockResolvedValueOnce(1).mockResolvedValue(2);
    const result = setup(doc);
    await act(async () => {
      expect(await result.current.autosaveTab("a")).toBe("saved");
    });
    // The file's own line endings, as a manual save keeps them.
    expect(fs.writeTextFile).toHaveBeenCalledWith(
      "/notes/a.md",
      "edited\r\nline",
    );
    expect(result.current.tabState.tabs[0]).toMatchObject({
      savedContent: "edited\nline",
      diskMtime: 2,
    });
  });

  describe("an untitled document", () => {
    const draft: DocTab = {
      ...doc,
      path: null,
      content: "# Trip plan\n\nday one",
      savedContent: "",
      diskMtime: null,
    };
    const onDisk = (taken: string[]) =>
      vi
        .mocked(fs.fileMtimeMs)
        .mockImplementation(async (p) => (taken.includes(p) ? 7 : null));
    // A new file: written with the editor's own line endings.
    beforeEach(() => {
      vi.mocked(fs.readTextFile).mockRejectedValue(new Error("not found"));
    });

    it("is saved into the open folder under its heading, without a dialog", async () => {
      onDisk(["/work/Trip plan.md"]);
      const result = setup(draft, "/work");
      await act(async () => {
        expect(await result.current.autosaveTab("a")).toBe("saved");
      });
      expect(fs.saveFileDialog).not.toHaveBeenCalled();
      // The taken name is numbered, never overwritten.
      expect(fs.writeTextFile).toHaveBeenCalledWith(
        "/work/Trip plan 2.md",
        draft.content,
      );
      expect(result.current.tabState.tabs[0]).toMatchObject({
        path: "/work/Trip plan 2.md",
        savedContent: draft.content,
      });
    });

    it("goes to Documents with no folder open", async () => {
      onDisk([]);
      vi.mocked(documentsDir).mockResolvedValue("/home/me/Documents/");
      const result = setup(draft);
      await act(async () => {
        expect(await result.current.autosaveTab("a")).toBe("saved");
      });
      expect(fs.writeTextFile).toHaveBeenCalledWith(
        "/home/me/Documents/Trip plan.md",
        draft.content,
      );
    });

    it("stays a draft with nowhere to go, or nothing in it", async () => {
      vi.mocked(documentsDir).mockRejectedValue(new Error("no Documents"));
      const nowhere = setup(draft);
      const blank = setup({ ...draft, content: " \n" }, "/work");
      await act(async () => {
        expect(await nowhere.current.autosaveTab("a")).toBe("skipped");
        expect(await blank.current.autosaveTab("a")).toBe("skipped");
      });
      expect(fs.writeTextFile).not.toHaveBeenCalled();
    });

    it("takes the next number when two drafts of one name save together", async () => {
      const written: string[] = [];
      vi.mocked(fs.fileMtimeMs).mockImplementation(async (p) =>
        written.includes(p) ? 7 : null,
      );
      vi.mocked(fs.writeTextFile).mockImplementation(async (p) => {
        written.push(p);
      });
      const result = setup(draft, "/work");
      act(() =>
        result.current.tabState.setTabs([draft, { ...draft, id: "b" }]),
      );
      await act(async () => {
        await Promise.all([
          result.current.autosaveTab("a"),
          result.current.autosaveTab("b"),
        ]);
      });
      expect(written).toEqual(["/work/Trip plan.md", "/work/Trip plan 2.md"]);
    });
  });

  it("keeps a file changed on disk unless the user chooses to overwrite", async () => {
    vi.mocked(fs.fileMtimeMs).mockResolvedValue(5);
    vi.mocked(showConfirm).mockResolvedValue(false);
    const result = setup(doc);
    await act(async () => {
      expect(await result.current.autosaveTab("a")).toBe("conflict");
    });
    expect(showConfirm).toHaveBeenCalledTimes(1);
    expect(fs.writeTextFile).not.toHaveBeenCalled();
  });

  it("starts an autosave's conflict prompt on Cancel, a manual save's on Overwrite", async () => {
    vi.mocked(fs.fileMtimeMs).mockResolvedValue(5);
    vi.mocked(showConfirm).mockResolvedValue(false);
    const result = setup(doc);
    await act(async () => {
      await result.current.autosaveTab("a");
      await result.current.saveTab("a");
    });
    const focusCancel = vi
      .mocked(showConfirm)
      .mock.calls.map(([, options]) => options.focusCancel);
    expect(focusCancel).toEqual([true, false]);
  });

  it("reports a failed write as the save error", async () => {
    vi.mocked(fs.fileMtimeMs).mockResolvedValue(1);
    vi.mocked(fs.writeTextFile).mockRejectedValue("Permission denied");
    const result = setup(doc);
    await act(async () => {
      expect(await result.current.autosaveTab("a")).toBe("failed");
    });
    expect(showMessage).toHaveBeenCalledTimes(1);
    expect(result.current.tabState.tabs[0].savedContent).toBe("original");
  });

  it("does not take its own earlier write for an outside change", async () => {
    // A save right behind another, before React has rendered the first
    // one's new mtime into the tab state.
    vi.mocked(fs.fileMtimeMs)
      .mockResolvedValueOnce(1) // first save: conflict check
      .mockResolvedValue(2); // the file after it
    const result = setup(doc);
    await act(async () => {
      expect(await result.current.saveTab("a")).toBe(true);
      const { tabsRef } = result.current.tabState;
      tabsRef.current = [{ ...tabsRef.current[0], content: "more" }];
      expect(await result.current.autosaveTab("a")).toBe("saved");
    });
    expect(showConfirm).not.toHaveBeenCalled();
  });
});

describe("saveTabAs", () => {
  it("brings a document's images to the file it is saved as", async () => {
    vi.mocked(fs.fileMtimeMs).mockResolvedValue(3);
    vi.mocked(fs.saveFileDialog).mockResolvedValue("/elsewhere/b.md");
    vi.mocked(fs.readTextFile).mockRejectedValue("not found");
    vi.mocked(fs.migrateDraftImages).mockResolvedValue([
      { old: "pics/p.png", new: "assets/p.png" },
    ]);
    const result = setup({ ...doc, content: "![](pics/p.png)\n" });
    await act(async () => {
      expect(await result.current.saveTabAs("a")).toBe(true);
    });
    expect(fs.migrateDraftImages).toHaveBeenCalledWith(
      "/elsewhere/b.md",
      ["pics/p.png"],
      "assets",
      "/notes/a.md",
    );
    expect(fs.writeTextFile).toHaveBeenLastCalledWith(
      "/elsewhere/b.md",
      "![](assets/p.png)\n",
    );
    expect(result.current.tabState.tabs[0]).toMatchObject({
      path: "/elsewhere/b.md",
      content: "![](assets/p.png)\n",
      reloadKey: 1,
    });
  });
});
