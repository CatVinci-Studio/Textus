// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../i18n/locales/en";
import { TreeSelection } from "./tree-selection";
import { useRowMenu } from "./useRowMenu";
import type { ContextMenuItem } from "../engine/controls/ContextMenu";
import { activateTab, setWindowTabs } from "../engine/layout/store";

const platform = vi.hoisted(() => ({ mobile: false }));
vi.mock("../platform/capabilities", async (real) => ({
  ...(await real<typeof import("../platform/capabilities")>()),
  get isMobileApp() {
    return platform.mobile;
  },
  // Android's: no Trash. iOS's is the Files app's Recently Deleted.
  get canTrashFiles() {
    return !platform.mobile;
  },
}));

const renamed: string[] = [];

const labelsFor = (path: string, isDir: boolean) => {
  const noop = () => {};
  const { result } = renderHook(() =>
    useRowMenu({
      root: "/proj",
      linkBase: "/proj",
      t: en,
      reload: noop,
      onFileSelect: noop,
      setDraft: noop,
      onEnter: null,
      selection: new TreeSelection(),
      fileUndo: { record: () => undefined, show: noop, rowBeside: () => null },
      rename: (p: string) => void renamed.push(p),
      treeRef: { current: null },
      transfer: async () => false,
      onCollapseAll: noop,
    }),
  );
  act(() => result.current.openRowMenu({ x: 0, y: 0 }, path, isDir));
  const items = result.current.menu?.items ?? [];
  return {
    item: (label: string) =>
      items.find(
        (i): i is ContextMenuItem => i !== "separator" && i.label === label,
      ),
    title: result.current.menu?.title,
    labels: (result.current.menu?.items ?? []).map((i) =>
      i === "separator" ? "-" : i.label,
    ),
  };
};

describe("a tree row's menu", () => {
  afterEach(() => {
    platform.mobile = false;
  });

  it("is named for the row, heading a phone's sheet", () => {
    expect(labelsFor("/proj/a.md", false).title).toBe("a.md");
  });

  it("moves to the Trash where there is one; without (Android), deletes documents only", () => {
    expect(labelsFor("/proj/a.md", false).labels).toContain(en.treeTrash);
    expect(labelsFor("/proj/sub", true).labels).toContain(en.treeTrash);
    platform.mobile = true;
    const file = labelsFor("/proj/a.md", false).labels;
    expect(file).toContain(en.docDelete);
    expect(file).toContain(en.treeRenameItem);
    expect(file).not.toContain(en.treeTrash);
    const folder = labelsFor("/proj/sub", true).labels;
    expect(folder).toContain(en.treeRenameItem);
    expect(folder).not.toContain(en.docDelete);
    expect(folder).not.toContain(en.treeTrash);
  });

  it("the root's menu folds every folder; a row's does not offer it", () => {
    expect(labelsFor("/proj", true).labels).toContain(en.treeCollapseAll);
    expect(labelsFor("/proj/sub", true).labels).not.toContain(
      en.treeCollapseAll,
    );
  });

  it("a file's Insert Link goes into the saved document in use, offered only then", () => {
    const insertLink = (path: string, isDir = false) =>
      labelsFor(path, isDir).item(en.treeInsertLink);
    expect(insertLink("/proj/sub", true)).toBeUndefined();
    setWindowTabs(() => [{ id: "draft", path: null }]);
    activateTab("draft");
    expect(insertLink("/proj/pic.png")?.disabled).toBe(true);
    setWindowTabs(() => [{ id: "note", path: "/proj/a.md" }]);
    activateTab("note");
    expect(insertLink("/proj/pic.png")?.disabled).toBe(false);
    // Not a link to itself.
    expect(insertLink("/proj/a.md")?.disabled).toBe(true);
  });
});

it("Rename makes the row's name a field, not a dialog", () => {
  renamed.length = 0;
  labelsFor("/proj/a.md", false).item(en.treeRenameItem)!.onSelect();
  expect(renamed).toEqual(["/proj/a.md"]);
});
