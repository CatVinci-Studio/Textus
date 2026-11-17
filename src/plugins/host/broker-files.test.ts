// @vitest-environment jsdom
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
      fsStat: async (_id: string, _root: string, path: string) =>
        path.startsWith("gone") || path.endsWith("Dup 3.md")
          ? null
          : { path: `\\\\?\\C:\\notes\\${path}` },
      fsCreate: async () => {},
    },
  };
});

const kept = vi.hoisted(() => [] as unknown[]);
vi.mock("../../storage/project-settings", () => ({
  updateProjectSettings: async (
    _root: string,
    _key: string,
    change: (now: object) => object,
  ) => void kept.push(change({})),
}));

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

it("takes a badge off a file that is gone", async () => {
  const scope = { id: "p", root: () => "C:\\notes" } as PluginScope;
  const files = fileHandlers(scope);
  await files["files.setBadge"]({ path: "drafts/b.md", badge: { text: "1" } });
  expect(fileBadge("C:\\notes\\drafts\\b.md")).not.toBeNull();
  await expect(
    files["files.setBadge"]({ path: "gone.md", badge: { text: "1" } }),
  ).rejects.toThrow();
  await files["files.setBadge"]({ path: "gone.md", badge: null });
});

it("creates a file under a free name when asked, as given", async () => {
  const scope = { id: "p", root: () => "/notes" } as PluginScope;
  const files = fileHandlers(scope);
  await expect(
    files["files.create"]({ path: "inbox/Dup.md", text: "x", unique: true }),
  ).resolves.toBe("inbox/Dup 3.md");
  await expect(
    files["files.create"]({ path: "/notes/Dup.md", text: "x", unique: true }),
  ).resolves.toBe("/notes/Dup 3.md");
});

it("refuses a list as front matter, which would write 0: and 1: keys", async () => {
  const scope = {
    id: "p",
    root: () => "/notes",
    allows: () => true,
  } as unknown as PluginScope;
  await expect(
    fileHandlers(scope)["files.frontmatterSet"]({
      path: "a.md",
      frontmatter: ["x"],
    }),
  ).rejects.toThrow("frontmatter is an object.");
});

it("keeps a folder convention only as one of what Textus reads", async () => {
  const scope = { id: "p", root: () => "/notes" } as PluginScope;
  const set = fileHandlers(scope)["files.setConvention"];
  await set({ key: "linkStyle", value: "wiki" });
  await set({ key: "linkStyle", value: null });
  expect(kept).toEqual([{ linkStyle: "wiki" }, { linkStyle: undefined }]);
  await expect(
    set({ key: "linkStyle", value: { anything: ["else"] } }),
  ).rejects.toThrow();
  await expect(set({ key: "attachments", value: "x" })).rejects.toThrow();
  await expect(set({ key: "toString", value: "x" })).rejects.toThrow();
  expect(kept).toHaveLength(2);
});
