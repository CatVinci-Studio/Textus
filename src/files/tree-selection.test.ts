import { describe, expect, it } from "vitest";
import { fileClipboard } from "./file-clipboard";
import { outermost, TreeSelection } from "./tree-selection";

const rows = ["/p/a", "/p/b", "/p/c", "/p/d"].map((path) => ({
  path,
  isDir: false,
}));
const picked = (s: TreeSelection) =>
  rows.filter((row) => s.has(row.path)).map((row) => row.path);

describe("the file tree's picked rows", () => {
  it("a first ⌘-click picks the open document's row too, a second lets go", () => {
    const s = new TreeSelection();
    s.pick("toggle", "/p/c", rows, "/p/a");
    expect(picked(s)).toEqual(["/p/a", "/p/c"]);
    s.pick("toggle", "/p/a", rows, "/p/a");
    expect(picked(s)).toEqual(["/p/c"]);
  });

  it("Shift picks from the row last clicked, either way", () => {
    const s = new TreeSelection();
    s.clickedPlain(rows[3]!);
    s.pick("range", "/p/b", rows, null);
    expect(picked(s)).toEqual(["/p/b", "/p/c", "/p/d"]);
    s.clickedPlain(rows[0]!);
    expect(picked(s)).toEqual([]);
  });

  it("New makes things in the folder last clicked, or the clicked file's", () => {
    const s = new TreeSelection();
    expect(s.newEntryDir("/p", null)).toBe("/p");
    expect(s.newEntryDir("/p", "/p/notes/a.md")).toBe("/p/notes");
    s.clickedPlain({ path: "/p/notes/drafts", isDir: true });
    expect(s.newEntryDir("/p", "/p/a.md")).toBe("/p/notes/drafts");
    s.clickedPlain({ path: "/p/notes/b.md", isDir: false });
    expect(s.newEntryDir("/p", null)).toBe("/p/notes");
    // The tree moved elsewhere: not a folder outside it.
    expect(s.newEntryDir("/q", "/elsewhere/c.md")).toBe("/q");
  });

  it("a group is two or more, the row asked about among them", () => {
    const s = new TreeSelection();
    s.pick("toggle", "/p/b", rows, null);
    expect(s.groupOf("/p/b")).toBeNull();
    s.pick("toggle", "/p/c", rows, null);
    expect(s.groupOf("/p/a")).toBeNull();
    expect(s.groupOf("/p/b")?.map((row) => row.path)).toEqual(["/p/b", "/p/c"]);
  });

  it("a picked folder takes what is picked inside it along", () => {
    expect(
      outermost([
        { path: "/p/notes", isDir: true },
        { path: "/p/notes/n.md", isDir: false },
        { path: "/p/a.md", isDir: false },
      ]).map((row) => row.path),
    ).toEqual(["/p/notes", "/p/a.md"]);
  });
});

describe("picking with the keyboard", () => {
  it("Shift with an arrow picks from the row it started on, either way", () => {
    const s = new TreeSelection();
    s.extend("/p/b", "/p/c", rows);
    expect(picked(s)).toEqual(["/p/b", "/p/c"]);
    s.extend("/p/c", "/p/d", rows);
    expect(picked(s)).toEqual(["/p/b", "/p/c", "/p/d"]);
    s.extend("/p/d", "/p/c", rows);
    expect(picked(s)).toEqual(["/p/b", "/p/c"]);
    s.extend("/p/b", "/p/a", rows);
    expect(picked(s)).toEqual(["/p/a", "/p/b"]);
    // From a row not picked, a new range starts there.
    s.clear();
    s.extend("/p/d", "/p/c", rows);
    expect(picked(s)).toEqual(["/p/c", "/p/d"]);
  });

  it("Select All picks every row shown", () => {
    const s = new TreeSelection();
    s.selectAll(rows);
    expect(picked(s)).toEqual(rows.map((row) => row.path));
  });
});

describe("the paths the tree holds after a move or a delete", () => {
  it("follow a move and let go of what is gone, picked and cut alike", () => {
    const selection = new TreeSelection();
    const held = [
      { path: "/n/a", isDir: true },
      { path: "/n/a/x.md", isDir: false },
      { path: "/n/b.md", isDir: false },
    ];
    selection.selectAll(held);
    selection.moved("/n/a", "/n/z");
    expect(selection.picked.map((r) => r.path)).toEqual([
      "/n/z",
      "/n/z/x.md",
      "/n/b.md",
    ]);
    selection.keepOnly((p) => p !== "/n/b.md");
    expect(selection.picked.map((r) => r.path)).toEqual(["/n/z", "/n/z/x.md"]);

    fileClipboard.set({ rows: held, cut: true });
    fileClipboard.moved("/n/a", "/n/z");
    expect(fileClipboard.isCut("/n/z/x.md")).toBe(true);
    expect(fileClipboard.isCut("/n/a/x.md")).toBe(false);
    fileClipboard.keepOnly((p) => p === "/n/b.md");
    expect(fileClipboard.get()?.rows).toEqual([held[2]]);
    fileClipboard.set(null);
  });
});
