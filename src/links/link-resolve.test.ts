import { describe, expect, it } from "vitest";
import cases from "./link-resolve.cases.json";
import { noteIndex, noteLinkIn, pickNote, resolveNoteIn } from "./link-resolve";

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

describe("noteLinkIn writes links as the folder wants them", () => {
  const files = noteIndex([
    "Inbox.md",
    "a/Idea.md",
    "b/Idea.md",
    "a/My Note.md",
    "pic.png",
  ]);
  const wiki = { wiki: true, format: "shortest" } as const;

  it("names a note by its name alone when no other file has it", () => {
    expect(noteLinkIn(files, "a/My Note.md", "Inbox.md", wiki)).toBe(
      "[[My Note]]",
    );
    expect(noteLinkIn(files, "pic.png", "a/Idea.md", wiki)).toBe("[[pic.png]]");
  });

  it("names a note that shares its name by its path, shown by its name", () => {
    expect(noteLinkIn(files, "b/Idea.md", "Inbox.md", wiki)).toBe(
      "[[b/Idea|Idea]]",
    );
  });

  it("adds a heading, a block, an alias and the embed mark", () => {
    expect(
      noteLinkIn(files, "Inbox.md", "a/Idea.md", wiki, {
        heading: "Today",
        alias: "today",
      }),
    ).toBe("[[Inbox#Today|today]]");
    expect(
      noteLinkIn(files, "Inbox.md", "a/Idea.md", wiki, {
        block: "a1b2c3",
        embed: true,
      }),
    ).toBe("![[Inbox#^a1b2c3]]");
  });

  it("writes [[#Heading]] and [[#^id]] within the same note", () => {
    expect(
      noteLinkIn(files, "Inbox.md", "Inbox.md", wiki, { heading: "H" }),
    ).toBe("[[#H]]");
    expect(
      noteLinkIn(files, "Inbox.md", "Inbox.md", wiki, { block: "x1" }),
    ).toBe("[[#^x1]]");
  });

  it("follows a vault's relative, absolute and Markdown formats", () => {
    expect(
      noteLinkIn(files, "b/Idea.md", "a/Idea.md", {
        wiki: true,
        format: "relative",
      }),
    ).toBe("[[../b/Idea]]");
    expect(
      noteLinkIn(files, "a/My Note.md", "Inbox.md", {
        wiki: true,
        format: "absolute",
      }),
    ).toBe("[[a/My Note]]");
    expect(
      noteLinkIn(
        files,
        "a/My Note.md",
        "Inbox.md",
        { wiki: false, format: "shortest" },
        {
          heading: "Part one",
        },
      ),
    ).toBe("[My Note](My%20Note.md#Part%20one)");
  });

  it("writes links that lead back to the note they name", () => {
    for (const to of ["a/My Note.md", "b/Idea.md", "a/Idea.md"]) {
      const link = noteLinkIn(files, to, "Inbox.md", wiki);
      expect(resolveNoteIn(files, link, "Inbox.md")?.path).toBe(to);
    }
  });
});
