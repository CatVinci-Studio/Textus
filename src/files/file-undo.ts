import { fs } from "../platform/ipc";
import { unsavedAtOrUnder } from "../registry/open-documents";
import { trashable } from "./tree-shared";

/** An entry a file operation made, and how it was just after: its time,
 *  and for a folder every entry's name and time under it. */
export interface MadeEntry {
  path: string;
  isDir: boolean;
  stamp: string;
}

/** One file operation the tree can take back. Another kind (a move, a
 *  rename, a new entry, a delete keeping where the Trash put it) is one
 *  more member here, with its row in UNDO and CAN_UNDO. */
export type FileStep = { kind: "copy"; made: readonly MadeEntry[] };

type StepOf<K extends FileStep["kind"]> = Extract<FileStep, { kind: K }>;

/** Taken back, or refused because what it made changed since. */
export type UndoOutcome = { done: true } | { done: false; changed: string[] };

/** What a stamp reads from the disk. */
export type StampFiles = Pick<typeof fs, "fileMtimeMs" | "listDir">;

/** What undoing reaches: the disk, the Trash, the open tabs. */
export interface UndoContext {
  trash: (path: string) => Promise<void>;
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
    return { done: false, changed: changed.map((m) => m.path) };
  for (const [i, { path }] of made.entries())
    if (now[i] !== null) await ctx.trash(path);
  return { done: true };
}

const UNDO: {
  [K in FileStep["kind"]]: (
    step: StepOf<K>,
    ctx: UndoContext,
  ) => Promise<UndoOutcome>;
} = {
  copy: (step, ctx) => trashUnchanged(step.made, ctx),
};

/** Whether a step can be taken back here: what goes to the Trash needs
 *  one, or the undo would delete for good. */
const CAN_UNDO: { [K in FileStep["kind"]]: (step: StepOf<K>) => boolean } = {
  copy: (step) =>
    step.made.length > 0 && step.made.every((m) => trashable(m.path)),
};

export function canUndo(step: FileStep): boolean {
  return CAN_UNDO[step.kind](step);
}

export function undoStep(
  step: FileStep,
  ctx: Partial<UndoContext> & Pick<UndoContext, "trash">,
): Promise<UndoOutcome> {
  return UNDO[step.kind](step, {
    files: fs,
    unsaved: unsavedAtOrUnder,
    ...ctx,
  });
}

/** How many steps the tree keeps to take back. */
const KEPT_STEPS = 50;

/** The tree's file operations to take back, newest last. A step is taken
 *  off once, so a notice's Undo and the key can't both run it. */
export function fileUndoStack() {
  const steps: FileStep[] = [];
  return {
    push(step: FileStep) {
      steps.push(step);
      if (steps.length > KEPT_STEPS) steps.shift();
    },
    clear() {
      steps.length = 0;
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
  };
}
