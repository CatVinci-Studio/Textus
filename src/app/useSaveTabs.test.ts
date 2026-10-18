// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSaveTabs } from "./useSaveTabs";
import { useTabState } from "./useTabState";
import { fs } from "../platform/ipc";
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
  },
  session: { addRecentFile: vi.fn() },
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

function setup(tab: DocTab) {
  const { result } = renderHook(() => {
    const tabState = useTabState();
    const saves = useSaveTabs({
      tabState,
      t: en as Strings,
      autoSuggestFilename: true,
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

  it("never asks where to save an untitled document", async () => {
    const result = setup({ ...doc, path: null, diskMtime: null });
    await act(async () => {
      expect(await result.current.autosaveTab("a")).toBe("skipped");
    });
    expect(fs.saveFileDialog).not.toHaveBeenCalled();
    expect(fs.writeTextFile).not.toHaveBeenCalled();
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
