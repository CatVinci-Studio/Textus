import { describe, expect, it } from "vitest";
import cases from "./link-resolve.cases.json";
import { noteIndex, pickNote, resolveNoteIn } from "./link-resolve";

const index = noteIndex(cases.files);

describe("pickNote follows the shared case table", () => {
  it.each(cases.cases)("$name", ({ from, note, wiki, expect: want }) => {
    const link = {
      wiki,
      embed: false,
      note,
      headings: [],
      block: null,
      alias: null,
    };
    expect(pickNote(index, link, from)).toBe(want);
  });
});

describe("resolveNoteIn", () => {
  it("reads a table's escaped bar as the alias's, not the name's", () => {
    expect(resolveNoteIn(index, "[[Note\\|the note]]", "b/Guide.md")).toEqual({
      path: "Note.md",
      exists: true,
      kind: "note",
      alias: "the note",
    });
  });

  it("takes a ^id as a block, never a heading", () => {
    expect(
      resolveNoteIn(index, "[[Note#^abc123]]", "a/Other.md"),
    ).toMatchObject({
      path: "a/Note.md",
      block: "abc123",
    });
    expect(
      resolveNoteIn(index, "[[Note#^abc123]]", "a/Other.md"),
    ).not.toHaveProperty("heading");
    expect(resolveNoteIn(index, "[[#^abc123]]", "a/Other.md")).toMatchObject({
      path: "a/Other.md",
      block: "abc123",
    });
    expect(resolveNoteIn(index, "Note.md#^abc123", "a/Other.md")).toMatchObject(
      { block: "abc123" },
    );
  });

  it("takes the last level of #A#B and drops an empty alias", () => {
    const target = resolveNoteIn(index, "[[Note#A#B|]]", "a/Other.md");
    expect(target).toEqual({
      path: "a/Note.md",
      exists: true,
      kind: "note",
      heading: "B",
    });
  });

  it("places a missing note where a click creates it", () => {
    expect(resolveNoteIn(index, "[[New idea]]", "a/Other.md")).toMatchObject({
      path: "a/New idea.md",
      exists: false,
    });
    expect(resolveNoteIn(index, "[[folder/New]]", "a/Other.md")).toMatchObject({
      path: "folder/New.md",
      exists: false,
    });
  });

  it("tells a file from a note, and a web link from either", () => {
    expect(resolveNoteIn(index, "[[file.pdf]]", "Note.md")).toMatchObject({
      kind: "file",
      exists: true,
    });
    expect(
      resolveNoteIn(index, "https://example.com/a.md", "Note.md"),
    ).toBeNull();
  });
});
