import { describe, expect, it, vi } from "vitest";

const open = vi.hoisted(() => new Set<string>());
vi.mock("../app-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../app-bridge")>()),
  getWindowAccess: () => ({
    documentAt: (path: string) => (open.has(path) ? { path } : null),
  }),
}));

vi.mock("../../platform/ipc", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../platform/ipc")>();
  return {
    ...real,
    plugins: {
      ...real.plugins,
      // As Rust answers on Windows: the path resolved, \\?\ and all.
      fsStat: async (_id: string, _root: string, path: string) => ({
        path: `\\\\?\\C:\\notes\\${path}`,
      }),
    },
  };
});

import { fileHandlers, openDocument } from "./broker-files";
import { fileBadge } from "../contributions/file-badges";
import type { PluginScope } from "./broker-scope";

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

it("puts a plugin's badge on the file as the tree spells its path", async () => {
  const scope = { id: "p", root: () => "C:\\notes" } as PluginScope;
  await fileHandlers(scope)["files.setBadge"]({
    path: "a.md",
    badge: { text: "3" },
  });
  expect(fileBadge("C:\\notes\\a.md")).not.toBeNull();
});
