import { describe, expect, it } from "vitest";
import type { DirEntryInfo } from "../platform/bindings/files";
import {
  setOpenDocument,
  setUnsavedCheck,
  unsavedAtOrUnder,
} from "../registry/open-documents";
import {
  fileUndoStack,
  stampOf,
  undoStep,
  type FileStep,
  type MadeEntry,
  type StampFiles,
} from "./file-undo";

/** A disk of paths and their times; a folder is a path others are under. */
function disk(times: Record<string, number>): StampFiles {
  return {
    fileMtimeMs: async (path) => times[path] ?? null,
    listDir: async (dir) => {
      const names = new Map<string, boolean>();
      for (const p of Object.keys(times)) {
        if (!p.startsWith(`${dir}/`)) continue;
        const [name, ...rest] = p.slice(dir.length + 1).split("/");
        names.set(name, rest.length > 0 || names.get(name) === true);
      }
      if (!names.size && !(dir in times)) throw new Error("gone");
      return [...names].map(([name, isDir]): DirEntryInfo => ({
        name,
        path: `${dir}/${name}`,
        is_dir: isDir,
        modified_ms: isDir ? 1 : times[`${dir}/${name}`],
        hidden: false,
        ignored: false,
      }));
    },
  };
}

const madeOf = async (
  files: StampFiles,
  path: string,
  isDir: boolean,
): Promise<MadeEntry> => ({
  path,
  isDir,
  stamp: (await stampOf(path, isDir, files))!,
});

/** A copy step undone on `files`, the paths it trashed. */
async function undoCopy(
  made: MadeEntry[],
  files: StampFiles,
  unsaved: (path: string) => boolean = () => false,
) {
  const trashed: string[] = [];
  const result = await undoStep(
    { kind: "copy", made },
    { trash: async (p) => void trashed.push(p), files, unsaved },
  );
  return { result, trashed };
}

describe("undoing a drop of files into the tree", () => {
  it("trashes the drop's copies alone, passing over one already gone", async () => {
    const times: Record<string, number> = {
      "/n/plan.md": 5,
      "/n/todo.md": 10,
      "/n/photos/day 1/boat.png": 10,
      "/n/photos/cover.png": 10,
      "/n/gone.md": 10,
    };
    const files = disk(times);
    const made = [
      await madeOf(files, "/n/todo.md", false),
      await madeOf(files, "/n/photos", true),
      await madeOf(files, "/n/gone.md", false),
    ];
    delete times["/n/gone.md"];
    expect(await undoCopy(made, files)).toEqual({
      result: { done: true },
      trashed: ["/n/todo.md", "/n/photos"],
    });
  });

  it("trashes nothing when a copy changed since, deep in a folder too", async () => {
    const times: Record<string, number> = {
      "/n/todo.md": 10,
      "/n/photos/day 1/boat.png": 10,
    };
    const files = disk(times);
    const made = [
      await madeOf(files, "/n/todo.md", false),
      await madeOf(files, "/n/photos", true),
    ];
    times["/n/photos/day 1/boat.png"] = 11;
    expect(await undoCopy(made, files)).toEqual({
      result: { done: false, changed: ["/n/photos"] },
      trashed: [],
    });
    times["/n/photos/day 1/boat.png"] = 10;
    times["/n/photos/day 1/new.md"] = 12;
    expect((await undoCopy(made, files)).trashed).toEqual([]);
    delete times["/n/photos/day 1/new.md"];
    times["/n/todo.md"] = 11;
    expect(await undoCopy(made, files)).toEqual({
      result: { done: false, changed: ["/n/todo.md"] },
      trashed: [],
    });
  });

  it("trashes nothing while a copy has unsaved changes in a tab", async () => {
    const files = disk({ "/n/photos/a.md": 10 });
    const made = [await madeOf(files, "/n/photos", true)];
    expect(await undoCopy(made, files, (p) => p === "/n/photos")).toEqual({
      result: { done: false, changed: ["/n/photos"] },
      trashed: [],
    });
  });

  it("knows a copied folder's documents open with unsaved changes", () => {
    const access = {
      text: () => "",
      revision: () => "1",
      replaceText: () => false,
    };
    setOpenDocument("/n/photos/notes.md", access);
    setUnsavedCheck((path) => path === "/n/photos/notes.md");
    try {
      expect(unsavedAtOrUnder("/n/photos")).toBe(true);
      expect(unsavedAtOrUnder("/n/photos/notes.md")).toBe(true);
      expect(unsavedAtOrUnder("/n/photo")).toBe(false);
      setUnsavedCheck(null);
      expect(unsavedAtOrUnder("/n/photos")).toBe(false);
    } finally {
      setUnsavedCheck(null);
      setOpenDocument("/n/photos/notes.md", null);
    }
  });

  it("leaves what a file manager drops in a folder out of its stamp", async () => {
    const times: Record<string, number> = { "/n/photos/a.png": 1 };
    const before = await stampOf("/n/photos", true, disk(times));
    times["/n/photos/.DS_Store"] = 9;
    expect(await stampOf("/n/photos", true, disk(times))).toBe(before);
  });
});

describe("the tree's undo stack", () => {
  const step = (path: string): FileStep => ({
    kind: "copy",
    made: [{ path, isDir: false, stamp: "1" }],
  });

  it("takes the newest first, each once; an older notice's Undo does nothing", () => {
    const stack = fileUndoStack();
    const first = step("/n/a.md");
    const second = step("/n/b.md");
    stack.push(first);
    stack.push(second);
    expect(stack.take(first)).toBeNull();
    expect(stack.take(second)).toBe(second);
    expect(stack.take(second)).toBeNull();
    expect(stack.take()).toBe(first);
    expect(stack.take()).toBeNull();
  });

  it("keeps the last fifty, and empties for another folder", () => {
    const stack = fileUndoStack();
    for (let i = 0; i < 60; i++) stack.push(step(`/n/${i}.md`));
    expect(stack.size).toBe(50);
    expect(stack.take()?.made[0].path).toBe("/n/59.md");
    stack.clear();
    expect(stack.take()).toBeNull();
  });
});
