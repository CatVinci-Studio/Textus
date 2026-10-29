import { describe, expect, it } from "vitest";
import { isDocumentName, matchFiles, searchEntries } from "./file-search";
import { nameCollator } from "../utils/name-order";

const index = searchEntries(
  [
    "README.md",
    "drafts/Chapter One.md",
    "drafts/old/chapter-two.md",
    "notes/第一章 草稿.md",
    "notes/第二章.txt",
    "essays/café.md".normalize("NFD"),
    "essays/my chapter notes.md",
    "images/chapter-cover.png",
    "images/cover.png",
  ].map((rel) => ({ path: `/w/${rel}`, rel })),
  nameCollator("en"),
);

const names = (query: string, scope?: "all" | "documents", limit?: number) =>
  matchFiles(index, query, scope, limit).map((entry) => entry.name);

describe("file name search", () => {
  it("matches a part of the name, ignoring case", () => {
    expect(names("CHAPTER")).toEqual([
      "Chapter One.md",
      "chapter-two.md",
      "my chapter notes.md",
      "chapter-cover.png",
    ]);
  });

  it("lists documents before other files, then names that start with it first", () => {
    expect(names("cover")).toEqual(["cover.png", "chapter-cover.png"]);
    expect(names("chapter").at(-1)).toBe("chapter-cover.png");
    expect(names("chapter")[2]).toBe("my chapter notes.md");
  });

  it("leaves other files out with the documents-only filter", () => {
    expect(names("cover", "documents")).toEqual([]);
    expect(names("chapter", "documents")).toHaveLength(3);
  });

  it("matches Chinese names", () => {
    expect(names("第一章")).toEqual(["第一章 草稿.md"]);
    expect(names("章")).toHaveLength(2);
  });

  it("matches Chinese names typed in pinyin, whole or by initials", () => {
    expect(names("dierzhang")).toEqual(["第二章.txt"]);
    expect(names("cg")).toEqual(["第一章 草稿.md"]);
    expect(names("dz")).toEqual([]);
    expect(names("dyz")).toEqual(["第一章 草稿.md"]);
  });

  it("matches a decomposed name with a composed query", () => {
    expect(names("café")).toEqual(["café".normalize("NFD") + ".md"]);
    expect(names("cafe")).toEqual(["café".normalize("NFD") + ".md"]);
  });

  it("compares names only, not the folders they are in", () => {
    expect(names("drafts")).toEqual([]);
  });

  it("matches nothing for an empty or blank query", () => {
    expect(names("")).toEqual([]);
    expect(names("   ")).toEqual([]);
  });

  it("stops at the limit", () => {
    expect(names("md", "all", 2)).toHaveLength(2);
  });

  it("knows each file's folder from the indexed one", () => {
    const [first] = matchFiles(index, "chapter-two");
    expect(first.folder).toBe("drafts/old");
    expect(first.path).toBe("/w/drafts/old/chapter-two.md");
    expect(matchFiles(index, "readme")[0].folder).toBe("");
  });

  it("orders numbered names by their numbers", () => {
    const numbered = searchEntries(
      ["file10.md", "file2.md", "第10章.md", "第2章.md", "file1.md"].map(
        (rel) => ({ path: `/w/${rel}`, rel }),
      ),
      nameCollator("zh-CN"),
    );
    expect(matchFiles(numbered, "file").map((e) => e.name)).toEqual([
      "file1.md",
      "file2.md",
      "file10.md",
    ]);
    expect(matchFiles(numbered, "章").map((e) => e.name)).toEqual([
      "第2章.md",
      "第10章.md",
    ]);
  });
});

describe("isDocumentName", () => {
  it("knows the types Textus opens as documents", () => {
    expect(isDocumentName("a.MD")).toBe(true);
    expect(isDocumentName("notes.txt")).toBe(true);
    expect(isDocumentName("photo.png")).toBe(false);
    expect(isDocumentName(".md")).toBe(false);
    expect(isDocumentName("Makefile")).toBe(false);
  });
});
