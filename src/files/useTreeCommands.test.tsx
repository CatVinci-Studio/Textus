// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DirEntryInfo } from "../platform/bindings/files";
import { TreeRowsInSight } from "./TreeRowsInSight";
import { TreeSelection, type TreeRow } from "./tree-selection";
import { useTreeCommands } from "./useTreeCommands";

const os = vi.hoisted(() => ({ mac: false }));
vi.mock("../platform/os", async (real) => ({
  ...(await real<typeof import("../platform/os")>()),
  isMacPlatform: () => os.mac,
  modIsMeta: () => os.mac,
}));

beforeEach(() => {
  // jsdom lays nothing out: every row counts as shown.
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([
    {},
  ] as unknown as DOMRectList);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  os.mac = false;
});

const files = (dir: string, n: number) =>
  Array.from(
    { length: n },
    (_, i) => ({ name: `f${i}.md`, path: `${dir}/f${i}.md` }) as DirEntryInfo,
  );

/** A tree of two folders' rows, the first with more than are drawn at
 *  once, its keys going to the commands. */
function setup() {
  const selection = new TreeSelection();
  const did: string[] = [];
  function Tree() {
    const ref = { current: null as HTMLDivElement | null };
    const onKey = useTreeCommands({
      treeRef: ref,
      selection,
      rename: (p) => did.push(`rename ${p}`),
      open: (p) => did.push(`open ${p}`),
      trash: (rows: readonly TreeRow[]) =>
        did.push(`trash ${rows.map((r) => r.path).join(" ")}`),
    });
    const row = (e: DirEntryInfo) => (
      <div key={e.path} role="treeitem" tabIndex={-1} data-path={e.path}>
        {e.name}
      </div>
    );
    return (
      <div ref={(el) => void (ref.current = el)} role="tree" onKeyDown={onKey}>
        {["/a", "/b"].map((dir) => (
          <TreeRowsInSight
            key={dir}
            dir={dir}
            entries={files(dir, dir === "/a" ? 250 : 3)}
            needed={() => false}
            row={row}
          />
        ))}
      </div>
    );
  }
  const { container } = render(<Tree />);
  const at = (path: string) =>
    container.querySelector<HTMLElement>(`[data-path="${path}"]`)!;
  return { selection, did, at };
}

it("Select All picks a big folder's rows that were not drawn yet", () => {
  const { selection, at } = setup();
  act(() => at("/b/f0.md").focus());
  act(() => {
    fireEvent.keyDown(at("/b/f0.md"), { key: "a", ctrlKey: true });
  });
  expect(selection.picked).toHaveLength(253);
});

it("Enter opens and F2 renames elsewhere; on a Mac Return renames and ⌘↓ opens", () => {
  const { did, at } = setup();
  const row = at("/b/f1.md");
  fireEvent.keyDown(row, { key: "Enter" });
  fireEvent.keyDown(row, { key: "F2" });
  os.mac = true;
  fireEvent.keyDown(row, { key: "Enter" });
  fireEvent.keyDown(row, { key: "ArrowDown", metaKey: true });
  expect(did).toEqual([
    "open /b/f1.md",
    "rename /b/f1.md",
    "rename /b/f1.md",
    "open /b/f1.md",
  ]);
});

it("Delete (⌘⌫ on a Mac) trashes the row, or the picked rows it is one of", () => {
  const { selection, did, at } = setup();
  fireEvent.keyDown(at("/b/f0.md"), { key: "Delete" });
  act(() => at("/b/f0.md").focus());
  fireEvent.keyDown(at("/b/f0.md"), { key: "ArrowDown", shiftKey: true });
  expect(selection.picked.map((r) => r.path)).toEqual(["/b/f0.md", "/b/f1.md"]);
  os.mac = true;
  fireEvent.keyDown(at("/b/f1.md"), { key: "Backspace", metaKey: true });
  expect(did).toEqual(["trash /b/f0.md", "trash /b/f0.md /b/f1.md"]);
});

it("a Shift-click's range takes a big folder's rows that were not drawn yet", async () => {
  const { useTreeSelection } = await import("./tree-selection");
  let picked: TreeSelection | null = null;
  function Tree() {
    const { treeRef, selection, onRowPick } = useTreeSelection("/", null);
    picked = selection;
    return (
      <div ref={treeRef} role="tree">
        {["/a", "/b"].map((dir) => (
          <TreeRowsInSight
            key={dir}
            dir={dir}
            entries={files(dir, dir === "/a" ? 250 : 3)}
            needed={() => false}
            row={(e) => (
              <div
                key={e.path}
                role="treeitem"
                data-path={e.path}
                onClick={(ev) => onRowPick(ev, e.path)}
              />
            )}
          />
        ))}
      </div>
    );
  }
  const { container } = render(<Tree />);
  const at = (path: string) =>
    container.querySelector<HTMLElement>(`[data-path="${path}"]`)!;
  fireEvent.click(at("/a/f100.md"));
  fireEvent.click(at("/b/f1.md"), { shiftKey: true });
  expect(picked!.picked).toHaveLength(150 + 2);
});
