import { describe, expect, it } from "vitest";
import {
  absoluteIn,
  basename,
  fileUrlAsLink,
  fileUrlPath,
  dirname,
  folderName,
  hasUrlScheme,
  isDrivePath,
  isInside,
  isWithin,
  movedTo,
  onTheWay,
  joinPath,
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
  it("reads an Android picked folder's entries by their document ids", () => {
    const tree =
      "content://com.android.externalstorage.documents/tree/primary%3ANotes";
    const dir = `${tree}/document/primary%3ANotes`;
    expect(isInside(`${tree}/document/primary%3ANotes%2Fa.md`, dir)).toBe(true);
    expect(isInside(`${tree}/document/primary%3ANotes%2Fb%2Fc.md`, dir)).toBe(
      true,
    );
    expect(isInside(`${tree}/document/primary%3ANotesX%2Fa.md`, dir)).toBe(
      false,
    );
    expect(isInside(dir, dir)).toBe(false);
    expect(
      isInside("content://other/document/primary%3ANotes%2Fa.md", dir),
    ).toBe(false);
    // Its folder, a part up in the same tree; none above the tree's top.
    expect(parentDir(`${tree}/document/primary%3ANotes%2Fb%2Fc.md`)).toBe(
      `${tree}/document/primary%3ANotes%2Fb`,
    );
    expect(dirname(`${tree}/document/primary%3ANotes%2Fa.md`)).toBe(dir);
    expect(parentDir(dir)).toBe(null);
  });
  it("onTheWay knows a target and the folders holding it", () => {
    const way = onTheWay("/a/b/c.md", null, "C:\\x\\y");
    for (const path of ["/a/b/c.md", "/a/b", "/a", "C:\\x", "C:/x/y"])
      expect(way(path)).toBe(true);
    for (const path of ["/a/bc", "/a/b/d.md", "/b"])
      expect(way(path)).toBe(false);
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

describe("fileUrlPath", () => {
  it("reads every way a file: URL names a local file", () => {
    const cases: [string, string][] = [
      ["file:///D:/notes/local.png", "D:/notes/local.png"],
      ["file://D:/notes/local.png", "D:/notes/local.png"],
      ["file:///d:/notes/local.png", "d:/notes/local.png"],
      ["file:///D:/notes/local%20space.png", "D:/notes/local space.png"],
      ["file:///D:/notes/%E5%9B%BE%E7%89%87.png", "D:/notes/图片.png"],
      ["file:///D:/notes/图片.png", "D:/notes/图片.png"],
      ["FILE:///D:/notes/a.png", "D:/notes/a.png"],
      ["file:///Users/me/a.png", "/Users/me/a.png"],
      ["file://localhost/Users/me/a.png", "/Users/me/a.png"],
    ];
    for (const [url, path] of cases) expect(fileUrlPath(url)).toBe(path);
  });

  it("leaves other schemes, plain paths and other hosts alone", () => {
    for (const src of [
      "https://x.org/a.png",
      "D:/notes/a.png",
      "assets/a.png",
      "file://server/share/a.png",
      "file:////server/share/a.png",
      "file://\\\\server\\share\\a.png",
      "file:///%5C%5Cserver%5Cshare%5Ca.png",
      "file:///%2F%2Fserver/share/a.png",
    ])
      expect(fileUrlPath(src)).toBeNull();
  });
});

describe("fileUrlAsLink", () => {
  it("writes a file: URL as its path, a # in a name kept in the name", () => {
    expect(fileUrlAsLink("file:///D:/a%23b%20c.md#Part")).toBe(
      "D:/a%23b%20c.md#Part",
    );
    expect(fileUrlAsLink("notes/a.md#Part")).toBe("notes/a.md#Part");
  });
});

describe("isInside, walking dots", () => {
  it("counts a path climbing out with .. as outside", () => {
    expect(isInside("/notes/../etc/passwd", "/notes")).toBe(false);
    expect(isInside("/notes/a/../../../etc", "/notes")).toBe(false);
    expect(isInside("/notes/a/./b.md", "/notes")).toBe(true);
    expect(isInside("C:\\notes\\..\\win.ini", "C:\\notes")).toBe(false);
    expect(isInside("C:\\notes\\a\\b.md", "C:\\notes\\")).toBe(true);
  });
});

describe("absoluteIn", () => {
  it("puts a relative path inside the folder, in the folder's spelling", () => {
    expect(absoluteIn("/notes/", "Inbox.md")).toBe("/notes/Inbox.md");
    expect(absoluteIn("C:\\notes", "a\\b.md")).toBe("C:\\notes\\a\\b.md");
    expect(absoluteIn("/notes", "/elsewhere/c.md")).toBe("/elsewhere/c.md");
    // A colon after one letter is a name, not a drive, without a separator.
    expect(absoluteIn("/notes", "a:b.zip")).toBe("/notes/a:b.zip");
    expect(absoluteIn("/notes", "D:\\x.md")).toBe("D:\\x.md");
    // A plugin writes "/" and "./" on Windows too: the tree's spelling.
    expect(absoluteIn("C:\\notes", "./drafts/a.md")).toBe(
      "C:\\notes\\drafts\\a.md",
    );
    expect(absoluteIn("/notes", "./a.md")).toBe("/notes/a.md");
    expect(absoluteIn("/notes", "a\\b.md")).toBe("/notes/a\\b.md");
  });
});

describe("joinPath and folderName", () => {
  it("join with the folder's own separator, one between them", () => {
    expect(joinPath("/v/", "/a.md")).toBe("/v/a.md");
    expect(joinPath("C:\\v\\", "a.md")).toBe("C:\\v\\a.md");
    // Written with both: "/" wins, as a Windows path given that way works.
    expect(joinPath("C:\\v/w", "a.md")).toBe("C:\\v/w/a.md");
  });
  it("name a folder by its last part, a disk's root by itself", () => {
    expect(folderName("/Users/me/Notes/")).toBe("Notes");
    expect(folderName("C:\\Work")).toBe("Work");
    expect(folderName("/")).toBe("/");
  });
});

describe("one path however its separators are written", () => {
  it("is within itself and its folder, a Windows path in either slash", () => {
    expect(isWithin("C:\\p\\notes/plan.md", "C:\\p\\notes\\plan.md")).toBe(
      true,
    );
    expect(isWithin("C:/p/notes", "C:\\p\\notes")).toBe(true);
    expect(isWithin("/p/notes", "/p/notesX")).toBe(false);
  });

  it("follows a move, in the new place's spelling", () => {
    expect(movedTo("/p/a/b.md", "/p/a", "/p/z")).toBe("/p/z/b.md");
    expect(movedTo("/p/a", "/p/a", "/p/z")).toBe("/p/z");
    expect(movedTo("C:\\p\\a\\b\\c.md", "C:\\p\\a", "C:\\q")).toBe(
      "C:\\q\\b\\c.md",
    );
    expect(movedTo("/p/ab.md", "/p/a", "/p/z")).toBeNull();
  });
});
