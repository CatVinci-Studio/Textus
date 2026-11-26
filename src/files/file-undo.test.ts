import { describe, expect, it } from "vitest";
import type { DirEntryInfo } from "../platform/bindings/files";
import {
  setOpenDocument,
  setUnsavedCheck,
  unsavedAtOrUnder,
} from "../registry/open-documents";
import {
  stampOf,
  undoStep,
  type FileStep,
  type MadeEntry,
  type TrashedEntry,
  type StampFiles,
} from "./file-undo";
import type { TextEdit } from "./move-links";

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

/** What undoing reaches, on `files`, writing down what it did. */
function reach(
  files: StampFiles,
  unsaved: (path: string) => boolean = () => false,
) {
  const did: string[] = [];
  const ctx = {
    files,
    unsaved,
    trash: async (paths: readonly string[]) => {
      for (const p of paths) did.push(`trash ${p}`);
      return { places: paths.map((p) => `bin:${p}`), error: undefined };
    },
    putBack: async (place: string, p: string) =>
      void did.push(`back ${place} ${p}`),
    move: async (from: string, to: string) =>
      void did.push(`move ${from} ${to}`),
    revertEdits: async (edits: readonly TextEdit[]) =>
      edits.map((e) => ({ ...e, before: e.after, after: e.before })),
  };
  return { did, ctx };
}

/** A copy step undone on `files`, the paths it trashed. */
async function undoCopy(
  made: MadeEntry[],
  files: StampFiles,
  unsaved: (path: string) => boolean = () => false,
) {
  const { did, ctx } = reach(files, unsaved);
  const result = await undoStep({ kind: "made", made }, ctx);
  const trashed = did.map((d) => d.slice("trash ".length));
  return { result: result.done ? { done: true } : result, trashed };
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
      result: { done: false, reason: "changed", paths: ["/n/photos"] },
      trashed: [],
    });
    times["/n/photos/day 1/boat.png"] = 10;
    times["/n/photos/day 1/new.md"] = 12;
    expect((await undoCopy(made, files)).trashed).toEqual([]);
    delete times["/n/photos/day 1/new.md"];
    times["/n/todo.md"] = 11;
    expect(await undoCopy(made, files)).toEqual({
      result: { done: false, reason: "changed", paths: ["/n/todo.md"] },
      trashed: [],
    });
  });

  it("trashes nothing while a copy has unsaved changes in a tab", async () => {
    const files = disk({ "/n/photos/a.md": 10 });
    const made = [await madeOf(files, "/n/photos", true)];
    expect(await undoCopy(made, files, (p) => p === "/n/photos")).toEqual({
      result: { done: false, reason: "changed", paths: ["/n/photos"] },
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

describe("undoing and redoing the tree's moves, renames and deletes", () => {
  it("puts what went to the Trash back, last first, and trashes it again on redo", async () => {
    const times: Record<string, number> = {};
    const files = disk(times);
    const trashed: TrashedEntry[] = [
      { path: "/n/a.md", isDir: false, place: "bin:1" },
      { path: "/n/b.md", isDir: false, place: "bin:2" },
    ];
    const { did, ctx } = reach(files);
    ctx.putBack = async (place, p) => {
      did.push(`back ${place} ${p}`);
      times[p] = 1;
    };
    const result = await undoStep({ kind: "trashed", trashed }, ctx);
    expect(did).toEqual(["back bin:2 /n/b.md", "back bin:1 /n/a.md"]);
    expect(result.done && result.show).toBe("/n/a.md");
    const redo = result.done ? result.redo! : null;
    expect(redo?.kind).toBe("made");
    did.length = 0;
    const again = await undoStep(redo!, ctx);
    expect(did).toEqual(["trash /n/a.md", "trash /n/b.md"]);
    expect(again.done && again.redo).toEqual({
      kind: "trashed",
      trashed: [
        { path: "/n/a.md", isDir: false, place: "bin:/n/a.md" },
        { path: "/n/b.md", isDir: false, place: "bin:/n/b.md" },
      ],
    });
  });

  it("puts nothing back where something else now is", async () => {
    const { did, ctx } = reach(disk({ "/n/b.md": 3 }));
    const result = await undoStep(
      {
        kind: "trashed",
        trashed: [
          { path: "/n/a.md", isDir: false, place: "bin:1" },
          { path: "/n/b.md", isDir: false, place: "bin:2" },
        ],
      },
      ctx,
    );
    expect(result).toEqual({
      done: false,
      reason: "taken",
      paths: ["/n/b.md"],
    });
    expect(did).toEqual([]);
  });

  it("moves back, last first, takes its link updates back, and redoes the move", async () => {
    const { did, ctx } = reach(disk({ "/n/sub/a.md": 1, "/n/sub/b": 1 }));
    const edits: TextEdit[] = [
      { path: "/n/index.md", before: "[a](a.md)", after: "[a](sub/a.md)" },
    ];
    const step: FileStep = {
      kind: "moved",
      moved: [
        { from: "/n/a.md", to: "/n/sub/a.md" },
        { from: "/n/b", to: "/n/sub/b" },
      ],
      edits: Promise.resolve(edits),
    };
    const result = await undoStep(step, ctx);
    expect(did).toEqual(["move /n/sub/b /n/b", "move /n/sub/a.md /n/a.md"]);
    if (!result.done || result.redo?.kind !== "moved")
      throw new Error("no redo");
    expect(result.redo.moved).toEqual([
      { from: "/n/sub/a.md", to: "/n/a.md" },
      { from: "/n/sub/b", to: "/n/b" },
    ]);
    expect(await result.redo.edits).toEqual([
      { path: "/n/index.md", before: "[a](sub/a.md)", after: "[a](a.md)" },
    ]);
  });

  it("moves nothing back when it is gone or its old place is taken; a rename of case alone goes back", async () => {
    const moved = (from: string, to: string): FileStep => ({
      kind: "moved",
      moved: [{ from, to }],
      edits: Promise.resolve([]),
    });
    const files = disk({ "/n/b.md": 1, "/n/a.md": 1, "/n/Notes.md": 1 });
    expect(
      await undoStep(moved("/n/x.md", "/n/gone.md"), reach(files).ctx),
    ).toEqual({ done: false, reason: "gone", paths: ["/n/gone.md"] });
    expect(
      await undoStep(moved("/n/a.md", "/n/b.md"), reach(files).ctx),
    ).toEqual({
      done: false,
      reason: "taken",
      paths: ["/n/a.md"],
    });
    const { did, ctx } = reach(files);
    expect(
      (await undoStep(moved("/n/notes.md", "/n/Notes.md"), ctx)).done,
    ).toBe(true);
    expect(did).toEqual(["move /n/Notes.md /n/notes.md"]);
  });

  it("takes back several steps done as one, last first", async () => {
    const { did, ctx } = reach(disk({ "/n/a.md": 1 }));
    const result = await undoStep(
      {
        kind: "steps",
        steps: [
          {
            kind: "trashed",
            trashed: [{ path: "/n/b.md", isDir: false, place: "bin:1" }],
          },
          {
            kind: "moved",
            moved: [{ from: "/x/b.md", to: "/n/a.md" }],
            edits: Promise.resolve([]),
          },
        ],
      },
      ctx,
    );
    expect(did).toEqual(["move /n/a.md /x/b.md", "back bin:1 /n/b.md"]);
    expect(result.done).toBe(true);
  });
});
