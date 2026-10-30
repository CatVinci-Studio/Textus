import { ownNotes } from "../platform/ipc";

/**
 * Track My Changes keeps a document's file as it was, with only the changes
 * accepted, and the writer's own undecided changes beside it in .textus - as
 * Textus AI's undecided proposals are kept. Shared as a folder, both go along.
 * The sidecar holds the original (`base`, what the file holds) and the text
 * with the changes (`revised`, what the editor shows).
 */

interface Revisions {
  base?: unknown;
  revised?: unknown;
}

/** The original of each tracked document, by path, as markdown. */
const bases = new Map<string, () => string | null>();
/** Documents with a sidecar on disk, which an untracked save clears. */
const keptBeside = new Set<string>();
/** Writes a tracked document whose original moved while it had nothing
 *  unsaved (a change accepted, tracking stopped); the window's saver. */
let writeIfSaved: ((path: string) => void) | null = null;

/** While a document is tracked: what its file should hold. */
export function trackFile(path: string, base: () => string | null) {
  bases.set(path, base);
  return () => {
    if (bases.get(path) === base) bases.delete(path);
  };
}

/** What a document's file holds for the editor's `content`: its original
 *  while tracked, else the text itself. */
export function fileTextFor(path: string | null, content: string): string {
  return (path && bases.get(path)?.()) ?? content;
}

/** Writes the sidecar for a save of `content` to `path`; `from` is where the
 *  document was tracked, before a Save As. */
export async function writeRevisions(
  path: string,
  content: string,
  from: string | null = path,
): Promise<void> {
  const base = from ? (bases.get(from)?.() ?? null) : null;
  if (base === null && !keptBeside.has(path)) return;
  if (base === null) keptBeside.delete(path);
  else keptBeside.add(path);
  await ownNotes
    .write(
      path,
      "revisions",
      base === null ? "{}" : JSON.stringify({ base, revised: content }),
    )
    .catch(() => {});
}

/** The text a document opens with: its revised text when the file still
 *  holds the original it was revised from, else the file's. */
export async function openedText(
  path: string,
  fileText: string,
): Promise<string> {
  const saved = await ownNotes.read(path, "revisions").catch(() => null);
  if (!saved) return fileText;
  keptBeside.add(path);
  try {
    const { base, revised } = JSON.parse(saved) as Revisions;
    return typeof revised === "string" && base === fileText
      ? revised
      : fileText;
  } catch {
    return fileText;
  }
}

export function setTrackedWriter(write: ((path: string) => void) | null) {
  writeIfSaved = write;
}

/** A tracked document's original changed: its file follows, if nothing in
 *  it is unsaved; else the next save writes it. */
export function originalChanged(path: string): void {
  writeIfSaved?.(path);
}
