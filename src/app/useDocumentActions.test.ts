// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useDocumentActions } from "./useDocumentActions";
import { useTabState } from "./tabs/useTabState";
import { ENTRY_TRASHED_EVENT } from "../utils/events";
import type { DocTab } from "../document/doc-tabs";

afterEach(cleanup);

const tab = (id: string, path: string, content: string): DocTab => ({
  id,
  path,
  content,
  savedContent: "saved",
  diskMtime: 1,
  sourceMode: false,
  reloadKey: 0,
});

it("lets go of a folder's documents trashed in the sidebar: an edited one becomes a draft", () => {
  const { result } = renderHook(() => {
    const tabState = useTabState();
    useDocumentActions({
      tabState,
      openFile: async () => {},
      removeTab: (id) =>
        tabState.setTabs((prev) => prev.filter((t) => t.id !== id)),
      saveTab: async () => true,
    });
    return tabState;
  });
  act(() =>
    result.current.setTabs([
      tab("a", "/notes/old/a.md", "saved"),
      tab("b", "/notes/old/b.md", "edited"),
      tab("c", "/notes/c.md", "saved"),
    ]),
  );
  act(() => {
    window.dispatchEvent(
      new CustomEvent(ENTRY_TRASHED_EVENT, { detail: "/notes/old" }),
    );
  });
  const tabs = result.current.tabs;
  expect(tabs.map((t) => [t.id, t.path])).toEqual([
    ["b", null],
    ["c", "/notes/c.md"],
  ]);
});
