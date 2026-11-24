import { fs } from "../platform/ipc";

/** A copy one drop made in the tree, and how it was just after: its time,
 *  and for a folder every entry's name and time under it. */
export interface CopiedEntry {
  path: string;
  isDir: boolean;
  stamp: string;
}

/** What a stamp reads from the disk. */
export type StampFiles = Pick<typeof fs, "fileMtimeMs" | "listDir">;

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

export type CopyUndo =
  { done: true; trashed: string[] } | { done: false; changed: string[] };

/** One drop's copies to the Trash, or none of them when any changed since:
 *  a copy already gone is passed over. */
export async function undoCopies(
  copies: readonly CopiedEntry[],
  trash: (path: string) => Promise<void>,
  files: StampFiles = fs,
): Promise<CopyUndo> {
  const now = await Promise.all(
    copies.map((c) => stampOf(c.path, c.isDir, files)),
  );
  const changed = copies.filter(
    (c, i) => now[i] !== null && now[i] !== c.stamp,
  );
  if (changed.length)
    return { done: false, changed: changed.map((c) => c.path) };
  const trashed: string[] = [];
  for (const [i, { path }] of copies.entries()) {
    if (now[i] === null) continue;
    await trash(path);
    trashed.push(path);
  }
  return { done: true, trashed };
}

/** The last drop's copies, until undone or another drop: taken once, so a
 *  toast's Undo and the key can't both run it. */
export function lastDrop() {
  let held: readonly CopiedEntry[] | null = null;
  return {
    keep(copies: readonly CopiedEntry[] | null) {
      held = copies?.length ? copies : null;
    },
    has: () => held !== null,
    /** The copies, if `which` (when given) is still the last drop's. */
    take(which?: readonly CopiedEntry[]): readonly CopiedEntry[] | null {
      if (!held || (which && which !== held)) return null;
      const was = held;
      held = null;
      return was;
    },
  };
}
