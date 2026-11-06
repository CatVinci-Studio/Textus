import {
  noteFileNames,
  parseNoteLink,
  type NoteLink,
} from "../../utils/note-link";

/**
 * Where a link to a note leads, among a folder's files: the one resolver for
 * metadata, backlinks, Graph, rename and plugins. Rust's `vault.rs` answers
 * clicks with the same rules; `link-resolve.cases.json` holds both to them.
 */

/** A folder's files by their path from its root ("a/Note.md"), looked up
 *  without case and by name. */
export interface NoteIndex {
  /** Lower-cased path to the path as on disk. */
  byPath: Map<string, string>;
  /** Lower-cased file name to every path with it. */
  byName: Map<string, string[]>;
}

export function noteIndex(paths: readonly string[]): NoteIndex {
  const byPath = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const path of paths) {
    const lower = path.toLowerCase();
    byPath.set(lower, path);
    const name = lower.slice(lower.lastIndexOf("/") + 1);
    const same = byName.get(name);
    if (same) same.push(path);
    else byName.set(name, [path]);
  }
  return { byPath, byName };
}

/** `link` from the folder `dir`, "." and ".." folded; null above the root. */
function joined(dir: string, link: string): string | null {
  const parts = dir ? dir.split("/") : [];
  for (const part of link.split(/[\\/]/)) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** Steps between two folders: up to their common one, then down. */
function distance(from: string, to: string): number {
  const a = from ? from.split("/") : [];
  const b = to ? to.split("/") : [];
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common])
    common++;
  return a.length - common + (b.length - common);
}

/** The file at `path` from the root in any of `note`'s spellings. */
function direct(index: NoteIndex, path: string | null): string | null {
  if (path === null) return null;
  for (const name of noteFileNames(path)) {
    const found = index.byPath.get(name.toLowerCase());
    if (found) return found;
  }
  return null;
}

/** A name, or a path's tail, found anywhere: the nearest to `fromDir`,
 *  then the shortest path, then the first alphabetically. */
function byName(
  index: NoteIndex,
  note: string,
  fromDir: string,
): string | null {
  const names = noteFileNames(note);
  // A note's spellings (.md, .markdown) compete as one; a name as written
  // is only tried after them.
  const groups =
    names.length > 1 ? [names.slice(0, -1), names.slice(-1)] : [names];
  for (const group of groups) {
    const found = group.flatMap((name) => {
      const lower = name.toLowerCase().replace(/^\.\//, "");
      const file = lower.slice(lower.lastIndexOf("/") + 1);
      const tail = `/${lower}`;
      return (index.byName.get(file) ?? []).filter((path) => {
        const p = path.toLowerCase();
        return p === lower || p.endsWith(tail);
      });
    });
    if (!found.length) continue;
    return found.sort(
      (a, b) =>
        distance(fromDir, folderOf(a)) - distance(fromDir, folderOf(b)) ||
        a.length - b.length ||
        (a < b ? -1 : a > b ? 1 : 0),
    )[0];
  }
  return null;
}

/** Where the parsed `link`, in the file `from` (both from the root), leads
 *  among the indexed files; null when nothing there is it. */
export function pickNote(
  index: NoteIndex,
  link: NoteLink,
  from: string,
): string | null {
  const note = link.note.replace(/\\/g, "/");
  if (!note) return from;
  const fromDir = folderOf(from);
  if (note.startsWith("/")) return direct(index, joined("", note));
  const relative = note.startsWith("./") || note.startsWith("../");
  if (!link.wiki || relative) {
    const found = direct(index, joined(fromDir, note));
    // A bare Markdown link name is looked for elsewhere too, as a wikilink.
    if (found || relative || note.includes("/")) return found;
    return byName(index, note, fromDir);
  }
  if (note.includes("/"))
    return (
      direct(index, joined("", note)) ??
      direct(index, joined(fromDir, note)) ??
      byName(index, note, fromDir)
    );
  return byName(index, note, fromDir);
}

/** What a resolved link says about its target (contract B's ResolvedLink,
 *  less `line`, which needs the target's headings). */
export interface NoteTarget {
  path: string;
  exists: boolean;
  kind: "note" | "file";
  heading?: string;
  block?: string;
  alias?: string;
}

const MARKDOWN = /\.(md|markdown)$/i;

/**
 * `link` as written, from the file `from`, among `index`'s files - all paths
 * from the same root. A link to nothing that exists is placed where a click
 * creates it: a wikilink's folder from the root, else beside `from`.
 */
export function resolveNoteIn(
  index: NoteIndex,
  link: string,
  from: string,
): NoteTarget | null {
  const parsed = parseNoteLink(link);
  if (!parsed) return null;
  const found = pickNote(index, parsed, from);
  const note = parsed.note.replace(/\\/g, "/");
  const path =
    found ??
    joined(
      parsed.wiki && note.includes("/") && !note.startsWith(".")
        ? ""
        : folderOf(from),
      noteFileNames(note)[0],
    );
  if (path === null) return null;
  const heading = parsed.headings.at(-1);
  return {
    path,
    exists: found !== null,
    kind: MARKDOWN.test(path) ? "note" : "file",
    ...(heading ? { heading } : {}),
    ...(parsed.block ? { block: parsed.block } : {}),
    ...(parsed.alias ? { alias: parsed.alias } : {}),
  };
}
