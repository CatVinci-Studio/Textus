import { describe, expect, it } from "vitest";
import { globToRegExp, isDocumentPath } from "./glob";

describe("a glob", () => {
  const matches = (glob: string, path: string) => globToRegExp(glob).test(path);

  it("matches within a folder's name with *, any folders with **", () => {
    expect(matches("*.md", "a.md")).toBe(true);
    expect(matches("*.md", "notes/a.md")).toBe(false);
    expect(matches("**/*.md", "a.md")).toBe(true);
    expect(matches("**/*.md", "notes/2026/a.md")).toBe(true);
    expect(matches("Daily/*.md", "daily/2026-10-25.md")).toBe(true);
    expect(matches("notes/**", "notes/x/y.png")).toBe(true);
  });

  it("takes ? for one character and {a,b} for either", () => {
    expect(matches("?.md", "a.md")).toBe(true);
    expect(matches("?.md", "ab.md")).toBe(false);
    expect(matches("*.{png,jpg}", "x.jpg")).toBe(true);
    expect(matches("*.{png,jpg}", "x.gif")).toBe(false);
  });

  it("knows a document by its name", () => {
    expect(isDocumentPath("/a/b.md")).toBe(true);
    expect(isDocumentPath("/a/b.MARKDOWN")).toBe(true);
    expect(isDocumentPath("/a/b.pdf")).toBe(false);
  });
});
