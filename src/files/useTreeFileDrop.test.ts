// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import en from "../i18n/locales/en";
import { treeFileDrop } from "./tree-file-drop";
import { useTreeFileDrop } from "./useTreeFileDrop";

vi.mock("../prefs/SettingsContext", () => ({
  useSettings: () => ({
    settings: { confirmTreeCopy: true },
    setSettings: () => {},
    t: en,
  }),
}));
vi.mock("../platform/capabilities", async (real) => ({
  ...(await real<typeof import("../platform/capabilities")>()),
  canDropFilesIntoTree: true,
}));

afterEach(() => {
  document.body.innerHTML = "";
});

/** A tree with the folder `/proj/sub` under the pointer. */
function setup(folder: string | null) {
  const tree = document.createElement("div");
  const sub = document.createElement("div");
  sub.dataset.dropDir = "/proj/sub";
  tree.append(sub);
  document.body.append(tree);
  document.elementFromPoint = () => sub;
  const transfer = vi.fn(async () => true);
  renderHook(() =>
    useTreeFileDrop(
      { current: tree },
      folder,
      () => {},
      () => {},
      () => undefined,
      transfer,
    ),
  );
  return { transfer, drop: treeFileDrop()! };
}

const row = (path: string, isDir = false) => ({
  path,
  isDir,
  fromSystem: false,
});

it("the tree's own rows brought back onto a folder move there, or with the copy key are copied, with no folder open too", () => {
  const { transfer, drop } = setup(null);
  const rows = [row("/proj/a.md")];
  expect(drop.over(rows, 0, 0, { copy: false })).toBe(true);
  expect(drop.drop(rows, 0, 0, { copy: false })).toBe(true);
  expect(drop.drop(rows, 0, 0, { copy: true })).toBe(true);
  expect(transfer.mock.calls).toEqual([
    [rows, "/proj/sub", "move"],
    [rows, "/proj/sub", "copy"],
  ]);
  // A file manager's files go in only with a folder open.
  expect(drop.drop([{ path: "/downloads/b.md", isDir: false }], 0, 0)).toBe(
    false,
  );
});

it("rows brought back where they can't go are taken, and nothing moves", () => {
  const { transfer, drop } = setup("/proj");
  // Already there, or a folder into itself.
  expect(drop.drop([row("/proj/sub/a.md")], 0, 0, { copy: false })).toBe(true);
  expect(drop.drop([row("/proj/sub", true)], 0, 0, { copy: true })).toBe(true);
  expect(transfer).not.toHaveBeenCalled();
});
