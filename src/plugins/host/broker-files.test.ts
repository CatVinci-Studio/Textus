import { describe, expect, it, vi } from "vitest";

const open = vi.hoisted(() => new Set<string>());
vi.mock("../app-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../app-bridge")>()),
  getWindowAccess: () => ({
    documentAt: (path: string) => (open.has(path) ? { path } : null),
  }),
}));

import { openDocument } from "./broker-files";

describe("a plugin reaching an open document", () => {
  open.add("/notes/a.md");
  open.add("/notes/.obsidian/x.md");
  open.add("/private/diary.md");

  it("finds it by a path from the folder as by its full path", () => {
    expect(openDocument("/notes", "a.md")).toEqual({ path: "/notes/a.md" });
    expect(openDocument("/notes", "/notes/a.md")).toEqual({
      path: "/notes/a.md",
    });
  });

  it("doesn't reach one outside the folder or in a hidden folder", () => {
    expect(openDocument("/notes", "/private/diary.md")).toBeNull();
    expect(openDocument("/notes", ".obsidian/x.md")).toBeNull();
    expect(openDocument("/notes", "../private/diary.md")).toBeNull();
  });
});
