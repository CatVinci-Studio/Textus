import { describe, expect, it } from "vitest";
import type { DirEntryInfo } from "../platform/bindings/files";
import {
  lastDrop,
  stampOf,
  undoCopies,
  type CopiedEntry,
  type StampFiles,
} from "./tree-copy-undo";

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

const copyOf = async (
  files: StampFiles,
  path: string,
  isDir: boolean,
): Promise<CopiedEntry> => ({
  path,
  isDir,
  stamp: (await stampOf(path, isDir, files))!,
});

describe("undoing a drop of files into the tree", () => {
  it("trashes the drop's copies alone, passing over one already gone", async () => {
    const times = {
      "/n/plan.md": 5,
      "/n/todo.md": 10,
      "/n/photos/day 1/boat.png": 10,
      "/n/photos/cover.png": 10,
      "/n/gone.md": 10,
    };
    const files = disk(times);
    const copies = [
      await copyOf(files, "/n/todo.md", false),
      await copyOf(files, "/n/photos", true),
      await copyOf(files, "/n/gone.md", false),
    ];
    delete (times as Record<string, number>)["/n/gone.md"];
    const trashed: string[] = [];
    const result = await undoCopies(
      copies,
      async (p) => void trashed.push(p),
      files,
    );
    expect(result).toEqual({
      done: true,
      trashed: ["/n/todo.md", "/n/photos"],
    });
    expect(trashed).toEqual(["/n/todo.md", "/n/photos"]);
  });

  it("trashes nothing when a copy changed since, deep in a folder too", async () => {
    const times: Record<string, number> = {
      "/n/todo.md": 10,
      "/n/photos/day 1/boat.png": 10,
    };
    const files = disk(times);
    const copies = [
      await copyOf(files, "/n/todo.md", false),
      await copyOf(files, "/n/photos", true),
    ];
    const trashed: string[] = [];
    const trash = async (p: string) => void trashed.push(p);

    times["/n/photos/day 1/boat.png"] = 11;
    expect(await undoCopies(copies, trash, files)).toEqual({
      done: false,
      changed: ["/n/photos"],
    });
    times["/n/photos/day 1/boat.png"] = 10;
    times["/n/photos/day 1/new.md"] = 12;
    expect((await undoCopies(copies, trash, files)).done).toBe(false);
    delete times["/n/photos/day 1/new.md"];
    times["/n/todo.md"] = 11;
    expect(await undoCopies(copies, trash, files)).toEqual({
      done: false,
      changed: ["/n/todo.md"],
    });
    expect(trashed).toEqual([]);
  });

  it("leaves what a file manager drops in a folder out of its stamp", async () => {
    const times: Record<string, number> = { "/n/photos/a.png": 1 };
    const before = await stampOf("/n/photos", true, disk(times));
    times["/n/photos/.DS_Store"] = 9;
    expect(await stampOf("/n/photos", true, disk(times))).toBe(before);
  });

  it("is taken once, and only by the last drop's own Undo", () => {
    const drop = lastDrop();
    const first = [{ path: "/n/a.md", isDir: false, stamp: "1" }];
    const second = [{ path: "/n/b.md", isDir: false, stamp: "1" }];
    drop.keep(first);
    drop.keep(second);
    expect(drop.take(first)).toBeNull();
    expect(drop.take(second)).toBe(second);
    expect(drop.take()).toBeNull();
    drop.keep(first);
    expect(drop.take()).toBe(first);
    drop.keep([]);
    expect(drop.has()).toBe(false);
  });
});
