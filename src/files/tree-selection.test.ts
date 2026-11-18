import { describe, expect, it } from "vitest";
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
    s.clickedPlain("/p/d");
    s.pick("range", "/p/b", rows, null);
    expect(picked(s)).toEqual(["/p/b", "/p/c", "/p/d"]);
    s.clickedPlain("/p/a");
    expect(picked(s)).toEqual([]);
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
