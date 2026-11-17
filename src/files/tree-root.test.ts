import { describe, expect, it } from "vitest";
import { isWithin } from "../utils/path";
import { nextTreeRoot, rootAfterClose } from "./tree-root";

const root = (
  current: string | null,
  docPath: string | null,
  folder: string | null = null,
  fallback: string | null = null,
) => nextTreeRoot({ current, folder, docPath, fallback });

describe("the file tree's root without an opened folder", () => {
  it("stays put when the document is in a subfolder of it", () => {
    expect(root("/notes", "/notes/novel/ch1.md")).toBe("/notes");
  });

  it("stays put after the user went up a level", () => {
    expect(root("/home/me", "/home/me/notes/a.md")).toBe("/home/me");
  });

  it("moves to the document's folder when it is outside", () => {
    expect(root("/notes/novel", "/notes/b.md")).toBe("/notes");
    expect(root("/notes", "/elsewhere/c.md")).toBe("/elsewhere");
  });

  it("starts at the first document's folder", () => {
    expect(root(null, "/notes/a.md")).toBe("/notes");
  });

  it("does not count a sibling with a longer name as inside", () => {
    expect(root("/notes", "/notes-old/a.md")).toBe("/notes-old");
  });

  it("keeps the tree for a draft, or shows the fallback folder", () => {
    expect(root("/notes", null)).toBe("/notes");
    expect(root(null, null)).toBeNull();
    expect(root("/notes", null, null, "/Documents")).toBe("/Documents");
  });

  it("keeps the tree for a document Android picked alone", () => {
    const picked =
      "content://com.android.externalstorage.documents/document/primary%3ADocuments%2Fnotes.md";
    expect(root("/notes", picked)).toBe("/notes");
    expect(root(null, picked, null, "/Documents")).toBe("/Documents");
  });

  it("works with Windows paths", () => {
    expect(root("C:\\Notes", "C:\\Notes\\Novel\\ch1.md")).toBe("C:\\Notes");
    expect(root("C:\\Notes", "D:\\Other\\x.md")).toBe("D:\\Other");
  });
});

describe("the file tree's root with an opened folder", () => {
  it("stays at the folder whatever document opens", () => {
    expect(root("/notes", "/notes/novel/ch1.md", "/notes")).toBe("/notes");
    expect(root("/notes", "/elsewhere/c.md", "/notes")).toBe("/notes");
    expect(root("/notes", null, "/notes", "/Documents")).toBe("/notes");
  });

  it("never narrows to a subfolder of it", () => {
    expect(root("/notes/novel", "/notes/novel/ch2.md", "/notes")).toBe(
      "/notes",
    );
    expect(root("/notes/novel", "/elsewhere/c.md", "/notes")).toBe("/notes");
  });

  it("starts at the folder, and returns to it from outside", () => {
    expect(root(null, "/elsewhere/c.md", "/notes")).toBe("/notes");
    expect(root("/elsewhere", "/elsewhere/c.md", "/notes")).toBe("/notes");
  });
});

describe("isWithin", () => {
  it("counts the folder itself and what is below it", () => {
    expect(isWithin("/notes", "/notes")).toBe(true);
    expect(isWithin("/notes/a/b.md", "/notes")).toBe(true);
    expect(isWithin("/notesx", "/notes")).toBe(false);
  });
});

describe("Close Folder", () => {
  it("goes back to the document's folder", () => {
    expect(rootAfterClose("/notes/a.md", "/home")).toBe("/notes");
  });
  it("never roots at an Android document's address", () => {
    expect(
      rootAfterClose(
        "content://com.android.externalstorage.documents/tree/primary%3ANotes/document/primary%3ANotes%2Fa.md",
        "/data/notes",
      ),
    ).toBe("/data/notes");
  });
});
