import type { DocTab } from "./doc-tabs";

/**
 * How Save Automatically gives an untitled document a file in the open
 * folder, with no dialog to ask: when, and under what name.
 */

/** Whether autosave may give an untitled tab a file of its own: a plain
 *  draft with something besides whitespace in it. Guides, plugin views and
 *  Word imports (whose Save As suggests a place of its own) are left out. */
export function untitledAutosavable(tab: DocTab): boolean {
  return (
    !tab.path &&
    !tab.view &&
    !tab.helpDoc &&
    !tab.importedFrom &&
    // Stops at the first visible character, not a copy of the document.
    /\S/.test(tab.content)
  );
}

/** Whether a draft's title is written: something follows its first line.
 *  Until then autosave waits longer, so a half-typed line doesn't name the
 *  file. */
export function titleSettled(markdown: string): boolean {
  return /\S[^\n]*\n\s*\S/.test(markdown);
}

/** "Notes.md" as the `n`th of its name: "Notes.md", "Notes 2.md", … */
export function numberedFilename(filename: string, n: number): string {
  if (n <= 1) return filename;
  const dot = filename.lastIndexOf(".");
  return dot > 0
    ? `${filename.slice(0, dot)} ${n}${filename.slice(dot)}`
    : `${filename} ${n}`;
}

/** `name` inside `dir`, with the separator `dir` is written with. */
export function joinFile(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.replace(/[\\/]+$/, "") + sep + name;
}

/** Numbered names tried before giving up, so a broken `exists` can't spin. */
const MAX_NUMBER = 1000;

/** The first path for `filename` in `dir` that `exists` says is free,
 *  numbered rather than overwriting; null if none is. */
export async function freeFilePath(
  dir: string,
  filename: string,
  exists: (path: string) => Promise<boolean>,
): Promise<string | null> {
  for (let n = 1; n <= MAX_NUMBER; n++) {
    const path = joinFile(dir, numberedFilename(filename, n));
    if (!(await exists(path))) return path;
  }
  return null;
}
