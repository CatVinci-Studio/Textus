import { fs } from "../platform/ipc";
import { farEntries } from "../platform/far-files";
import { unsavedAtOrUnder } from "../registry/open-documents";
import type { TextEdit } from "./move-links";
import { trashable } from "./tree-shared";

/** An entry a file operation made, and how it was just after: its time,
 *  and for a folder every entry's name and time under it. */
export interface MadeEntry {
  path: string;
  isDir: boolean;
  stamp: string;
}

/** An entry sent to the Trash, and where the Trash keeps it. */
export interface TrashedEntry {
  path: string;
  isDir: boolean;
  place: string;
}

/** An entry moved or renamed. */
export interface MovedEntry {
  from: string;
  to: string;
}

/** One file operation the tree can take back: what it made (a copy, a new
 *  entry, one put back), sent to the Trash, or moved, with the link
 *  updates the move wrote once they are settled. Several done as one (a
 *  replace: the old to the Trash, the new in its place) are one step. */
export type FileStep =
  | { kind: "made"; made: readonly MadeEntry[] }
  | { kind: "trashed"; trashed: readonly TrashedEntry[] }
  | {
      kind: "moved";
      moved: readonly MovedEntry[];
      edits: Promise<readonly TextEdit[]>;
    }
  | { kind: "steps"; steps: readonly FileStep[] };

type StepOf<K extends FileStep["kind"]> = Extract<FileStep, { kind: K }>;

/** Why nothing was taken back: what it made changed since, what it moved
 *  is gone from where it went, or something else now has its old place. */
export type UndoRefusal = "changed" | "gone" | "taken";

/** Taken back, with the step that does it again (null when it can't be);
 *  or refused, naming the entries in the way. */
export type UndoOutcome =
  | { done: true; redo: FileStep | null; show: string | null }
  | { done: false; reason: UndoRefusal; paths: string[] };

/** What a stamp reads from the disk. */
export type StampFiles = Pick<typeof fs, "fileMtimeMs" | "listDir">;

/** What undoing reaches: the disk, the Trash, the open tabs. */
export interface UndoContext {
  /** To the Trash; where it keeps it, when known. */
  trash: (path: string) => Promise<string | null>;
  putBack: (place: string, path: string) => Promise<void>;
  /** A move or a rename to exactly `to`, open tabs following. */
  move: (from: string, to: string) => Promise<void>;
  /** A move's link updates taken back once it went back (move-links.ts). */
  revertEdits: (
    edits: readonly TextEdit[],
    moved: readonly MovedEntry[],
  ) => Promise<TextEdit[]>;
  files: StampFiles;
  /** Whether a document at the path, or under it, has unsaved changes. */
  unsaved: (path: string) => boolean;
}

/** What a file manager leaves in a folder it shows, which no one wrote. */
const LITTER = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

/** How `path` is now; null when it is gone. */
export async function stampOf(
  path: string,
  isDir: boolean,
  files: StampFiles = fs,
): Promise<string | null> {
  if (!isDir) {
    const ms = await files.fileMtimeMs(path);
    return ms === null ? null : `${ms}`;
  }
  const lines: string[] = [];
  const walk = async (dir: string, rel: string) => {
    for (const entry of await files.listDir(dir)) {
      if (LITTER.has(entry.name)) continue;
      const at = `${rel}/${entry.name}`;
      lines.push(`${at}\t${entry.is_dir ? "d" : (entry.modified_ms ?? "")}`);
      if (entry.is_dir) await walk(entry.path, at);
    }
  };
  try {
    await walk(path, "");
  } catch {
    return null;
  }
  return lines.sort().join("\n");
}

const exists = async (path: string, files: StampFiles) =>
  (await files.fileMtimeMs(path).catch(() => null)) !== null;

/** The paths of `paths` for which `test` holds. */
async function where(
  paths: readonly string[],
  test: (path: string) => Promise<boolean>,
): Promise<string[]> {
  const hits = await Promise.all(paths.map(test));
  return paths.filter((_, i) => hits[i]);
}

/** Entries made to the Trash, or none of them when any changed since, on
 *  disk or in a tab not saved yet: one already gone is passed over. */
async function trashUnchanged(
  made: readonly MadeEntry[],
  ctx: UndoContext,
): Promise<UndoOutcome> {
  const now = await Promise.all(
    made.map((m) => stampOf(m.path, m.isDir, ctx.files)),
  );
  const changed = made.filter(
    (m, i) => now[i] !== null && (now[i] !== m.stamp || ctx.unsaved(m.path)),
  );
  if (changed.length)
    return {
      done: false,
      reason: "changed",
      paths: changed.map((m) => m.path),
    };
  const trashed: TrashedEntry[] = [];
  let known = true;
  for (const [i, { path, isDir }] of made.entries()) {
    if (now[i] === null) continue;
    const place = await ctx.trash(path);
    if (place === null) known = false;
    else trashed.push({ path, isDir, place });
  }
  const redo = known && trashed.length ? { kind: "trashed", trashed } : null;
  return { done: true, redo: redo as FileStep | null, show: null };
}

/** What went to the Trash put back, last first, unless something has one
 *  of their places now. */
async function putBackAll(
  trashed: readonly TrashedEntry[],
  ctx: UndoContext,
): Promise<UndoOutcome> {
  const paths = trashed.map((e) => e.path);
  const taken = await where(paths, (p) => exists(p, ctx.files));
  if (taken.length) return { done: false, reason: "taken", paths: taken };
  const made: MadeEntry[] = [];
  for (const { path, isDir, place } of [...trashed].reverse()) {
    await ctx.putBack(place, path);
    const stamp = await stampOf(path, isDir, ctx.files);
    if (stamp !== null) made.unshift({ path, isDir, stamp });
  }
  return {
    done: true,
    redo: made.length ? { kind: "made", made } : null,
    show: paths[0] ?? null,
  };
}

/** What was moved moved back, last first, its link updates with it. */
async function moveBack(
  step: StepOf<"moved">,
  ctx: UndoContext,
): Promise<UndoOutcome> {
  const edits = await step.edits;
  const gone = await where(
    step.moved.map((m) => m.to),
    async (p) => !(await exists(p, ctx.files)),
  );
  if (gone.length) return { done: false, reason: "gone", paths: gone };
  // A rename of case alone has its old name taken by itself.
  const taken = await where(
    step.moved
      .filter((m) => m.from.toLowerCase() !== m.to.toLowerCase())
      .map((m) => m.from),
    (p) => exists(p, ctx.files),
  );
  if (taken.length) return { done: false, reason: "taken", paths: taken };
  for (const { from, to } of [...step.moved].reverse())
    await ctx.move(to, from);
  const back = await ctx.revertEdits(edits, step.moved);
  return {
    done: true,
    redo: {
      kind: "moved",
      moved: step.moved.map(({ from, to }) => ({ from: to, to: from })),
      edits: Promise.resolve(back),
    },
    show: step.moved[0]?.from ?? null,
  };
}

/** Several steps done as one, taken back last first; what was taken back
 *  stays so when a later one is refused. */
async function undoAll(
  step: StepOf<"steps">,
  ctx: UndoContext,
): Promise<UndoOutcome> {
  const redo: FileStep[] = [];
  let show: string | null = null;
  for (const part of [...step.steps].reverse()) {
    const result = await UNDO[part.kind](part as never, ctx);
    if (!result.done) return result;
    if (result.redo) redo.unshift(result.redo);
    show ??= result.show;
  }
  return {
    done: true,
    redo: redo.length ? { kind: "steps", steps: redo.reverse() } : null,
    show,
  };
}

const UNDO: {
  [K in FileStep["kind"]]: (
    step: StepOf<K>,
    ctx: UndoContext,
  ) => Promise<UndoOutcome>;
} = {
  made: (step, ctx) => trashUnchanged(step.made, ctx),
  trashed: (step, ctx) => putBackAll(step.trashed, ctx),
  moved: moveBack,
  steps: undoAll,
};

/** Whether a step can be taken back here: what goes to the Trash needs
 *  one, or the undo would delete for good; what came from it needs where
 *  it went; a plugin's folder moves by its own rules. */
const CAN_UNDO: { [K in FileStep["kind"]]: (step: StepOf<K>) => boolean } = {
  made: (step) =>
    step.made.length > 0 && step.made.every((m) => trashable(m.path)),
  trashed: (step) => step.trashed.length > 0,
  moved: (step) =>
    step.moved.length > 0 && step.moved.every((m) => !farEntries(m.from)),
  steps: (step) => step.steps.length > 0 && step.steps.every(canUndo),
};

export function canUndo(step: FileStep): boolean {
  return CAN_UNDO[step.kind](step as never);
}

export function undoStep(
  step: FileStep,
  ctx: Partial<UndoContext> &
    Pick<UndoContext, "trash" | "putBack" | "move" | "revertEdits">,
): Promise<UndoOutcome> {
  return UNDO[step.kind](step as never, {
    files: fs,
    unsaved: unsavedAtOrUnder,
    ...ctx,
  });
}

/** How many steps the tree keeps to take back. */
const KEPT_STEPS = 50;

/** The tree's file operations to take back, newest last, and those taken
 *  back to do again. A step is taken off once, so a notice's Undo and the
 *  key can't both run it. */
export function fileUndoStack() {
  const steps: FileStep[] = [];
  const undone: FileStep[] = [];
  const keep = (list: FileStep[], step: FileStep) => {
    list.push(step);
    if (list.length > KEPT_STEPS) list.shift();
  };
  return {
    /** A new operation: what was undone before can't be done again. */
    push(step: FileStep) {
      keep(steps, step);
      undone.length = 0;
    },
    clear() {
      steps.length = 0;
      undone.length = 0;
    },
    get size() {
      return steps.length;
    },
    /** The newest step, taken off; with `which`, only if it is the newest
     *  (an older notice's Undo does nothing). */
    take(which?: FileStep): FileStep | null {
      const top = steps[steps.length - 1];
      if (!top || (which && which !== top)) return null;
      return steps.pop()!;
    },
    /** A step was taken back: `redo` does it again. */
    undone(redo: FileStep) {
      keep(undone, redo);
    },
    /** The newest step taken back, to do again. */
    takeRedo(): FileStep | null {
      return undone.pop() ?? null;
    },
    /** A step done again: `undo` takes it back once more. */
    redone(undo: FileStep) {
      keep(steps, undo);
    },
  };
}
