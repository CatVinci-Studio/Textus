import { beforeEach, describe, expect, it, vi } from "vitest";

// A picked Android folder as the native plugin sees it: URLs by document id.
const TREE =
  "content://com.android.externalstorage.documents/tree/primary%3ANotes";
const url = (id: string) => `${TREE}/document/${encodeURIComponent(id)}`;
const ROOT = url("primary:Notes");
const files = new Map<string, string | null>(); // id → text, null a folder

const idOf = (u: string) =>
  decodeURIComponent(u.slice(u.indexOf("/document/") + 10));

vi.mock("./ios-files", () => ({
  iosFiles: {
    listFolder: async (u: string) => {
      const dir = idOf(u);
      return [...files]
        .filter(([id]) => id.slice(0, id.lastIndexOf("/")) === dir)
        .map(([id, text]) => ({
          name: id.slice(id.lastIndexOf("/") + 1),
          path: url(id),
          is_dir: text === null,
        }));
    },
    createEntry: async (dir: string, name: string, folder: boolean) => {
      const id = `${idOf(dir)}/${name}`;
      files.set(id, folder ? null : "");
      return url(id);
    },
    readText: async (u: string) => files.get(idOf(u)) ?? "",
    readBase64: async (u: string) => btoa(files.get(idOf(u)) ?? ""),
    writeText: async (u: string, text: string) => {
      files.set(idOf(u), text);
    },
    moveEntry: async (u: string, _from: string, into: string) => {
      const id = `${idOf(into)}/${idOf(u).split("/").pop()}`;
      files.set(id, files.get(idOf(u))!);
      files.delete(idOf(u));
      return url(id);
    },
    renameEntry: async (u: string, name: string) => {
      const id = `${idOf(u).slice(0, idOf(u).lastIndexOf("/"))}/${name}`;
      files.set(id, files.get(idOf(u))!);
      files.delete(idOf(u));
      return url(id);
    },
  },
}));

const { contentPath, contentPluginFs: fs } =
  await import("./content-plugin-fs");

beforeEach(() => {
  files.clear();
  files.set("primary:Notes/a.md", "# A");
});

describe("a plugin's files in a content:// folder", () => {
  it("names a path inside the folder, never one climbing out", () => {
    expect(contentPath(ROOT, "inbox/b.md")).toBe(
      url("primary:Notes/inbox/b.md"),
    );
    expect(contentPath(ROOT, "./a.md")).toBe(url("primary:Notes/a.md"));
    expect(contentPath(ROOT, "")).toBe(ROOT);
    expect(() => contentPath(ROOT, "../Other/x.md")).toThrow(/outside/);
    expect(() => contentPath(ROOT, url("primary:Other/x.md"))).toThrow(
      /outside/,
    );
  });

  it("creates a file with its folders, refusing one there already", async () => {
    await fs.create(ROOT, "daily/2026/11-17.md", "today");
    expect(files.get("primary:Notes/daily")).toBeNull();
    expect(files.get("primary:Notes/daily/2026/11-17.md")).toBe("today");
    await expect(fs.create(ROOT, "a.md", "")).rejects.toThrow(/exists/);
  });

  it("writes only the version read", async () => {
    const { token } = await fs.readVersioned(ROOT, "a.md");
    expect(await fs.writeIf(ROOT, "a.md", "# B", token)).toBe(true);
    expect(await fs.writeIf(ROOT, "a.md", "# C", token)).toBe(false);
    expect(files.get("primary:Notes/a.md")).toBe("# B");
  });

  it("moves and renames in one, and lists and stats what is there", async () => {
    await fs.rename(ROOT, "a.md", "done/b.md");
    expect(files.has("primary:Notes/a.md")).toBe(false);
    expect(files.get("primary:Notes/done/b.md")).toBe("# A");
    expect((await fs.list(ROOT, "done")).map((e) => e.name)).toEqual(["b.md"]);
    expect(await fs.stat(ROOT, "a.md")).toBeNull();
    await expect(fs.trash()).rejects.toThrow(/Trash/);
  });
});

describe("a file picked with Open…, outside any folder", () => {
  it("is read and written by its own URL", async () => {
    const picked =
      "content://com.android.providers.downloads.documents/document/42";
    files.set("42", "views: []");
    expect(new TextDecoder().decode(await fs.readResource(picked))).toBe(
      "views: []",
    );
    await fs.writeResource(picked, "views:\n  - type: table");
    expect(files.get("42")).toBe("views:\n  - type: table");
  });
});
