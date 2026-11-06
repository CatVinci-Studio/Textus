import { describe, expect, it } from "vitest";
import { noteFileNames, parseNoteLink } from "./note-link";

const wiki = (note: string, more: object = {}) => ({
  wiki: true,
  embed: false,
  note,
  headings: [],
  block: null,
  alias: null,
  ...more,
});

describe("parseNoteLink", () => {
  it("reads a note, a heading in it and the text shown", () => {
    expect(parseNoteLink("[[Page]]")).toEqual(wiki("Page"));
    expect(parseNoteLink("[[folder/Page|shown]]")).toEqual(
      wiki("folder/Page", { alias: "shown" }),
    );
    expect(parseNoteLink("[[Page#Part two|see]]")).toEqual(
      wiki("Page", { headings: ["Part two"], alias: "see" }),
    );
    expect(parseNoteLink("![[Page]]")).toEqual(wiki("Page", { embed: true }));
  });

  it("reads a table's \\| as the alias's bar, not part of the name", () => {
    expect(parseNoteLink("[[Note\\|alias]]")).toEqual(
      wiki("Note", { alias: "alias" }),
    );
  });

  it("drops an empty alias", () => {
    expect(parseNoteLink("[[Note|]]")).toEqual(wiki("Note"));
  });

  it("reads #A#B as levels and ^id as a block, never a heading", () => {
    expect(parseNoteLink("[[Note#A#B]]")).toEqual(
      wiki("Note", { headings: ["A", "B"] }),
    );
    expect(parseNoteLink("[[Note#^abc123|x]]")).toEqual(
      wiki("Note", { block: "abc123", alias: "x" }),
    );
    expect(parseNoteLink("[[#^abc123]]")).toEqual(
      wiki("", { block: "abc123" }),
    );
    expect(parseNoteLink("[[#Intro]]")).toEqual(
      wiki("", { headings: ["Intro"] }),
    );
  });

  it("reads a Markdown link's target, decoded", () => {
    expect(parseNoteLink("My%20Note.md#^abc")).toMatchObject({
      wiki: false,
      note: "My Note.md",
      block: "abc",
    });
    expect(parseNoteLink("<My Note.md>")).toMatchObject({ note: "My Note.md" });
    expect(parseNoteLink("C:\\notes\\a.md")).toMatchObject({
      note: "C:\\notes\\a.md",
    });
  });

  it("reads nothing else", () => {
    expect(parseNoteLink("[[]]")).toBeNull();
    expect(parseNoteLink("[[a]] b")).toBeNull();
    expect(parseNoteLink("https://example.com/a.md")).toBeNull();
    expect(parseNoteLink("")).toBeNull();
  });
});

describe("noteFileNames", () => {
  it("tries a note before a dotted name's own extension", () => {
    expect(noteFileNames("Note v1.2")).toEqual(["Note v1.2.md", "Note v1.2"]);
    expect(noteFileNames("file.pdf")).toEqual(["file.pdf.md", "file.pdf"]);
    expect(noteFileNames("a.md")).toEqual(["a.md"]);
  });
});
