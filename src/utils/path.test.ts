import { describe, expect, it } from "vitest";
import {
  basename,
  hasUrlScheme,
  isDrivePath,
  isInside,
  parentDir,
} from "./path";

describe("parentDir", () => {
  it("steps up on POSIX and Windows paths", () => {
    expect(parentDir("/home/me/notes")).toBe("/home/me");
    expect(parentDir("/home")).toBe("/");
    expect(parentDir("/home/me/")).toBe("/home");
    expect(parentDir("C:\\Users\\me")).toBe("C:\\Users");
    expect(parentDir("C:\\Users")).toBe("C:\\");
  });
  it("stops at a root", () => {
    expect(parentDir("/")).toBeNull();
    expect(parentDir("C:\\")).toBeNull();
    expect(parentDir("\\\\server\\share")).toBeNull();
  });
});

describe("isInside", () => {
  it("matches only whole path segments below the folder", () => {
    expect(isInside("/a/b/c.md", "/a")).toBe(true);
    expect(isInside("/a/b/c.md", "/")).toBe(true);
    expect(isInside("C:\\a\\c.md", "C:\\")).toBe(true);
    expect(isInside("/ab/c.md", "/a")).toBe(false);
    expect(isInside("/a", "/a")).toBe(false);
  });
});

describe("basename of an iOS document URL", () => {
  it("decodes the file name", () => {
    expect(basename("file:///private/var/mobile/My%20Notes.md")).toBe(
      "My Notes.md",
    );
    expect(basename("/home/me/100%25.md")).toBe("100%25.md");
  });

  it("keeps a malformed escape as written", () => {
    expect(basename("file:///private/var/mobile/100%.md")).toBe("100%.md");
  });
});

describe("a drive path and a URL scheme", () => {
  it("tells a Windows drive path from a one-letter scheme", () => {
    expect(isDrivePath("C:\\Users\\me\\a.png")).toBe(true);
    expect(isDrivePath("d:/notes/a.png")).toBe(true);
    expect(isDrivePath("c:a.png")).toBe(false);
    expect(isDrivePath("/home/me/a.png")).toBe(false);
  });

  it("sees a scheme on URLs, never on a relative or absolute path", () => {
    for (const url of ["https://x.org", "data:image/png;base64,", "asset:x"])
      expect(hasUrlScheme(url)).toBe(true);
    for (const path of ["assets/a.png", "/home/me/a.png", "./a:b.png"])
      expect(hasUrlScheme(path)).toBe(false);
  });
});
