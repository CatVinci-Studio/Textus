// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../utils/tauri-events", () => ({
  listenToThisWindow: vi.fn(),
  unlistenAll: vi.fn(),
}));
vi.mock("../platform/ipc", () => ({
  fs: {},
  session: { addRecentFile: vi.fn() },
}));
vi.mock("../document/doc-tabs", async (original) => ({
  ...(await original<typeof import("../document/doc-tabs")>()),
  readDocFromDisk: vi.fn(async () => ({ content: "Same text.", diskMtime: 1 })),
}));
import { useFileOpening } from "./useFileOpening";
import { registerWorkspaceClose } from "../document/workspace-close";
import { makeBlankTab } from "../document/doc-tabs";
import type { TabState } from "./useTabState";
afterEach(cleanup);
it("guards window-mode replacement and creates a new document identity", async () => {
  const tab = {
    ...makeBlankTab(),
    workspaceId: "old-document",
    path: "/docs/a.md",
    content: "Same text.",
    savedContent: "Same text.",
  };
  const updateTab = vi.fn();
  const tabState = {
    tabsRef: { current: [tab] },
    activeTabId: tab.id,
    updateTab,
    setTabs: vi.fn(),
    setActiveTabId: vi.fn(),
  } as unknown as TabState;
  let allowed = false;
  const guard = vi.fn(async () => allowed);
  const remove = registerWorkspaceClose(tab.id, guard);
  const { result } = renderHook(() =>
    useFileOpening({
      tabState,
      newDocumentMode: "window",
      setPendingClose: vi.fn(),
    }),
  );
  await act(() => result.current.replaceTabWithFile(tab.id, "/docs/b.md"));
  expect(guard).toHaveBeenCalled();
  expect(updateTab).not.toHaveBeenCalled();
  allowed = true;
  await act(() => result.current.replaceTabWithFile(tab.id, "/docs/b.md"));
  expect(updateTab).toHaveBeenCalledWith(
    tab.id,
    expect.objectContaining({
      path: "/docs/b.md",
      workspaceId: expect.any(String),
    }),
  );
  expect(updateTab.mock.calls[0][1].workspaceId).not.toBe("old-document");
  remove();
});

it("window mode replaces only a pristine tab; a document in use keeps its tab", async () => {
  const blank = makeBlankTab();
  const saved = { ...makeBlankTab(), path: "/docs/a.md", content: "Text." };
  for (const [tab, replaced] of [
    [blank, true],
    [saved, false],
  ] as const) {
    const updateTab = vi.fn();
    const setTabs = vi.fn();
    const tabState = {
      tabsRef: { current: [tab] },
      activeTabId: tab.id,
      updateTab,
      setTabs,
      setActiveTabId: vi.fn(),
    } as unknown as TabState;
    const { result, unmount } = renderHook(() =>
      useFileOpening({
        tabState,
        newDocumentMode: "window",
        setPendingClose: vi.fn(),
      }),
    );
    await act(() => result.current.openFile("/docs/b.md"));
    expect(updateTab).toHaveBeenCalledTimes(replaced ? 1 : 0);
    expect(setTabs).toHaveBeenCalledTimes(replaced ? 0 : 1);
    unmount();
  }
});

it("a blank tab with an Agent conversation is not replaced", async () => {
  const { setTabEngaged } = await import("../document/doc-tabs");
  const tab = makeBlankTab();
  setTabEngaged(tab.id, true);
  const updateTab = vi.fn();
  const setTabs = vi.fn();
  const tabState = {
    tabsRef: { current: [tab] },
    activeTabId: tab.id,
    updateTab,
    setTabs,
    setActiveTabId: vi.fn(),
  } as unknown as TabState;
  const { result } = renderHook(() =>
    useFileOpening({
      tabState,
      newDocumentMode: "window",
      setPendingClose: vi.fn(),
    }),
  );
  await act(() => result.current.openFile("/docs/b.md"));
  expect(updateTab).not.toHaveBeenCalled();
  expect(setTabs).toHaveBeenCalledTimes(1);
  setTabEngaged(tab.id, false);
});
