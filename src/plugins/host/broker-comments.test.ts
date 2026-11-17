import { beforeEach, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => ({
  notes: new Map<string, string>(),
  files: new Map<string, string>(),
}));
vi.mock("../../platform/ipc", () => ({
  ownNotes: {
    read: async (path: string) => disk.notes.get(path) ?? null,
    write: async (path: string, _part: string, text: string) => {
      disk.notes.set(path, text);
    },
  },
  plugins: {
    fsRead: async (_id: string, _root: string, path: string) =>
      new TextEncoder().encode(disk.files.get(path) ?? ""),
  },
}));

const { commentHandlers } = await import("./broker-comments");
const { holdNotes, onNotesChanged } =
  await import("../../ai/margin/notes-by-path");
import type { PluginScope } from "./broker-scope";

const comments = commentHandlers({
  id: "a.review",
  name: () => "Review",
  root: () => "/work",
} as unknown as PluginScope);

beforeEach(() => {
  disk.notes.clear();
  disk.files.set("/work/a.md", "One line here.\n\nAnother one.\n");
  disk.notes.set(
    "/work/a.md",
    JSON.stringify([
      { id: "me-1", comment: "Mine", anchor: "Another", before: "" },
    ]),
  );
});

it("leaves, lists and resolves notes of a closed document in its notes file", async () => {
  const heard: string[] = [];
  const stop = onNotesChanged((path) => heard.push(path));
  const id = await comments["comments.add"]({
    path: "a.md",
    text: "line",
    comment: "  Too short?  ",
  });
  expect(await comments["comments.list"]({ path: "a.md" })).toEqual([
    { id: "me-1", text: "Another", comment: "Mine", author: null },
    { id, text: "line", comment: "Too short?", author: "Review" },
  ]);
  expect(await comments["comments.resolve"]({ path: "a.md", id: "me-1" })).toBe(
    true,
  );
  expect(await comments["comments.resolve"]({ path: "a.md", id: "me-1" })).toBe(
    false,
  );
  expect(JSON.parse(disk.notes.get("/work/a.md")!)).toHaveLength(1);
  expect(heard).toEqual(["/work/a.md", "/work/a.md"]);
  stop();
});

it("refuses words the file hasn't, and files outside the folder", async () => {
  await expect(
    comments["comments.add"]({ path: "a.md", text: "absent", comment: "x" }),
  ).rejects.toThrow(/isn't in/);
  await expect(
    comments["comments.list"]({ path: "/elsewhere/b.md" }),
  ).rejects.toThrow(/open folder/);
  await expect(
    comments["comments.add"]({ path: "a.md", text: "a\nb", comment: "x" }),
  ).rejects.toThrow(/one paragraph/);
});

it("changes an open document's notes in its editor, never its file under it", async () => {
  const add = vi.fn(() => "plugin-1");
  const remove = vi.fn(() => true);
  let ready = false;
  const release = holdNotes("/work/a.md", {
    ready: () => ready,
    list: () => [{ id: "me-2", comment: "Live", anchor: "One", before: "" }],
    add,
    remove,
  });
  // Until the editor has read them, the file is still theirs.
  expect(await comments["comments.list"]({ path: "a.md" })).toHaveLength(1);
  expect((await comments["comments.list"]({ path: "a.md" }))[0].comment).toBe(
    "Mine",
  );
  ready = true;
  const before = disk.notes.get("/work/a.md");
  expect(
    await comments["comments.add"]({
      path: "a.md",
      text: "One",
      comment: "Hi",
    }),
  ).toBe("plugin-1");
  expect(add).toHaveBeenCalledWith({
    anchor: "One",
    comment: "Hi",
    author: "Review",
  });
  expect(await comments["comments.resolve"]({ path: "a.md", id: "me-2" })).toBe(
    true,
  );
  expect(remove).toHaveBeenCalledWith("me-2");
  expect((await comments["comments.list"]({ path: "a.md" }))[0].comment).toBe(
    "Live",
  );
  expect(disk.notes.get("/work/a.md")).toBe(before);
  release();
});
