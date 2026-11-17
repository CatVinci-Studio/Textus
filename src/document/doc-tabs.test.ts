import { describe, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => ({
  read: vi.fn<(path: string) => Promise<string>>(),
  bytes: vi.fn<(path: string) => Promise<string>>(),
  mtime: vi.fn<(path: string) => Promise<number | null>>(),
  written: [] as [string, string][],
}));
vi.mock("../platform/ipc", () => ({
  fs: {
    readTextFile: disk.read,
    readBinaryFileBase64: disk.bytes,
    fileMtimeMs: disk.mtime,
    writeTextFile: async (path: string, text: string) => {
      disk.written.push([path, text]);
    },
  },
}));

import {
  adjacentTabId,
  makeBlankTab,
  tabTip,
  windowIsUntouched,
  writeDocFile,
} from "./doc-tabs";
import { resolveStrings } from "../i18n/strings";

describe("adjacentTabId", () => {
  const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("steps to the next and the previous tab in bar order", () => {
    expect(adjacentTabId(tabs, "a", 1)).toBe("b");
    expect(adjacentTabId(tabs, "c", -1)).toBe("b");
  });

  it("wraps from the last tab to the first, and back", () => {
    expect(adjacentTabId(tabs, "c", 1)).toBe("a");
    expect(adjacentTabId(tabs, "a", -1)).toBe("c");
  });

  it("has nowhere to go with a single tab", () => {
    expect(adjacentTabId([{ id: "a" }], "a", 1)).toBeNull();
  });
});

describe("windowIsUntouched", () => {
  it("holds for a fresh window's Untitled tab", () => {
    expect(windowIsUntouched([makeBlankTab()])).toBe(true);
  });

  it("fails once something is typed in the Untitled tab", () => {
    expect(windowIsUntouched([{ ...makeBlankTab(), content: "x" }])).toBe(
      false,
    );
  });

  it("fails for a window with a file open, even an empty saved one", () => {
    expect(
      windowIsUntouched([{ ...makeBlankTab(), path: "/notes/empty.md" }]),
    ).toBe(false);
  });

  it("fails for a window showing a Help document", () => {
    expect(
      windowIsUntouched([{ ...makeBlankTab(), helpDoc: "markdown" }]),
    ).toBe(false);
  });

  it("fails when any tab, not only the active one, holds something", () => {
    expect(
      windowIsUntouched([
        makeBlankTab(),
        { ...makeBlankTab(), content: "draft", savedContent: "" },
      ]),
    ).toBe(false);
  });
});

describe("tabTip", () => {
  const t = resolveStrings("en");
  it("names an untitled document by its first line, its marks left out", () => {
    const tab = { ...makeBlankTab(), content: "\n## Shopping list\nmilk" };
    expect(tabTip(tab, t)).toBe("Shopping list");
    expect(tabTip({ ...tab, content: "x".repeat(60) }, t)).toHaveLength(40);
    expect(tabTip(makeBlankTab(), t)).toBeUndefined();
    expect(tabTip({ ...tab, path: "/n/a.md" }, t)).toBeUndefined();
  });
});

describe("writeDocFile", () => {
  it("keeps the file's line endings, and writes a new file plain", async () => {
    disk.written.length = 0;
    disk.read.mockResolvedValueOnce("one\r\ntwo\r\n");
    await writeDocFile("/a.md", "one\ntwo\nthree\n");
    disk.read.mockRejectedValueOnce(new Error("not found"));
    disk.mtime.mockResolvedValueOnce(null);
    await writeDocFile("/new.md", "one\n");
    expect(disk.written).toEqual([
      ["/a.md", "one\r\ntwo\r\nthree\r\n"],
      ["/new.md", "one\n"],
    ]);
  });

  it("does not write over a file that is there but can't be read", async () => {
    disk.written.length = 0;
    disk.read.mockRejectedValueOnce(new Error("locked"));
    disk.bytes.mockRejectedValueOnce(new Error("locked"));
    disk.mtime.mockResolvedValueOnce(42);
    await expect(writeDocFile("/a.md", "one\n")).rejects.toThrow("locked");
    expect(disk.written).toEqual([]);
  });

  it("writes over a file that is there but not UTF-8, in its line endings", async () => {
    disk.written.length = 0;
    disk.read.mockRejectedValueOnce(new Error("invalid UTF-8"));
    disk.bytes.mockResolvedValueOnce(btoa("caf\xe9\r\nold\r\n"));
    disk.mtime.mockResolvedValueOnce(42);
    await writeDocFile("/a.txt", "new\n");
    expect(disk.written).toEqual([["/a.txt", "new\r\n"]]);
  });
});
