import { describe, expect, it } from "vitest";
import { matchFiles, searchEntries } from "./file-search";

const index = searchEntries(
  [
    "README.md",
    "drafts/Chapter One.md",
    "drafts/old/chapter-two.md",
    "notes/第一章 草稿.md",
    "notes/第二章.txt",
    "essays/café.md".normalize("NFD"),
    "essays/my chapter notes.md",
  ].map((rel) => ({ path: `/w/${rel}`, rel })),
);

const names = (query: string, limit?: number) =>
  matchFiles(index, query, limit).map((entry) => entry.name);

describe("file name search", () => {
  it("matches a part of the name, ignoring case", () => {
    expect(names("CHAPTER")).toEqual([
      "Chapter One.md",
      "chapter-two.md",
      "my chapter notes.md",
    ]);
  });

  it("lists names that start with the query first", () => {
    expect(names("chapter")[2]).toBe("my chapter notes.md");
  });

  it("matches Chinese names", () => {
    expect(names("第一章")).toEqual(["第一章 草稿.md"]);
    expect(names("章")).toEqual(["第一章 草稿.md", "第二章.txt"]);
  });

  it("matches a decomposed name with a composed query", () => {
    expect(names("café")).toEqual(["café".normalize("NFD") + ".md"]);
  });

  it("compares names only, not the folders they are in", () => {
    expect(names("drafts")).toEqual([]);
  });

  it("matches nothing for an empty or blank query", () => {
    expect(names("")).toEqual([]);
    expect(names("   ")).toEqual([]);
  });

  it("stops at the limit", () => {
    expect(names("md", 2)).toHaveLength(2);
  });

  it("knows each file's folder from the indexed one", () => {
    const [first] = matchFiles(index, "chapter-two");
    expect(first.folder).toBe("drafts/old");
    expect(first.path).toBe("/w/drafts/old/chapter-two.md");
    expect(matchFiles(index, "readme")[0].folder).toBe("");
  });
});
