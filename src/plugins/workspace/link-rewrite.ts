import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

/**
 * Links to renamed or moved files, made to point at their new place. A link is
 * matched by the file it really leads to (as a click resolves it), never by its
 * name alone; only the characters of its target change, every other byte stays.
 */

/** A rename or move: the files there were, and where each went. */
export interface LinkMove {
  /** Where `/…` links and a wiki link's folder path start: the vault or folder. */
  root: string;
  /** Every file under `root` before the move, absolute. */
  files: string[];
  /** Where a file went; null for one that stayed. */
  moved: (path: string) => string | null;
  /** In an Obsidian vault a Markdown link may name a note in another folder. */
  vault?: boolean;
}

function sep(path: string): string {
  return path.replace(/\\/g, "/");
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : "/";
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

const isNote = (path: string) => /\.(md|markdown)$/i.test(path);
const stripNote = (path: string) => path.replace(/\.(md|markdown)$/i, "");

/** `to`, written relative to the folder `fromDir`. */
export function relativePath(fromDir: string, to: string): string {
  const a = sep(fromDir).split("/").filter(Boolean);
  const b = sep(to).split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const up = a.slice(i).map(() => "..");
  return [...up, ...b.slice(i)].join("/") || ".";
}

/** `link` from the folder `dir`, `.` and `..` folded. */
function join(dir: string, link: string): string {
  const parts = sep(dir).split("/");
  for (const part of sep(link).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/") || "/";
}

/** Who a path is, looked up without case as the file systems Textus runs on. */
class FileIndex {
  private byLower = new Map<string, string>();
  constructor(readonly files: string[]) {
    for (const file of files) this.byLower.set(file.toLowerCase(), file);
  }
  find(path: string): string | null {
    return this.byLower.get(path.toLowerCase()) ?? null;
  }
  /** A file named by its tail: nearest folder to `dir`, then shortest, then
   *  alphabetical, as clicks pick (vault.rs pick_from_index). */
  pick(link: string, dir: string): string | null {
    const tail = `/${link.replace(/^\.\//, "").toLowerCase()}`;
    const from = dir.split("/");
    let best: string | null = null;
    let bestKey: [number, number, string] | null = null;
    for (const file of this.files) {
      if (!file.toLowerCase().endsWith(tail)) continue;
      const folders = dirOf(file).split("/");
      let common = 0;
      while (common < from.length && from[common] === folders[common]) common++;
      const key: [number, number, string] = [
        from.length - common + folders.length - common,
        file.length,
        file,
      ];
      if (
        !bestKey ||
        key[0] < bestKey[0] ||
        (key[0] === bestKey[0] &&
          (key[1] < bestKey[1] ||
            (key[1] === bestKey[1] && key[2] < bestKey[2])))
      ) {
        best = file;
        bestKey = key;
      }
    }
    return best;
  }
}

/** How a link names its file, so the new link is written the same way. */
type Form = "relative" | "rooted" | "name" | "path";

interface Resolved {
  path: string;
  form: Form;
}

/** Where a wiki link's name leads from the document at `doc`. */
function resolveWiki(
  index: FileIndex,
  root: string,
  name: string,
  doc: string,
): Resolved | null {
  const docDir = dirOf(doc);
  const relative = /^\.\.?\//.test(name);
  const hasDir = name.includes("/");
  for (const link of isNote(name) ? [name] : [name, `${name}.md`]) {
    if (hasDir && !relative) {
      const found = index.find(join(root, link));
      if (found) return { path: found, form: "path" };
    }
    const near = index.find(join(docDir, link));
    if (near)
      return {
        path: near,
        form: relative ? "relative" : hasDir ? "path" : "name",
      };
    if (relative) continue;
    const picked = index.pick(link, docDir);
    if (picked) return { path: picked, form: hasDir ? "path" : "name" };
  }
  return null;
}

/** Where a Markdown link's decoded path leads from the document at `doc`. */
function resolveMarkdown(
  index: FileIndex,
  move: LinkMove,
  file: string,
  doc: string,
): Resolved | null {
  if (file.startsWith("/")) {
    const rooted = index.find(join(move.root, file));
    if (rooted) return { path: rooted, form: "rooted" };
    const absolute = index.find(file);
    return absolute ? { path: absolute, form: "relative" } : null;
  }
  const near = join(dirOf(doc), file);
  const found =
    index.find(near) ??
    (/\.[^/]*$/.test(file) ? null : index.find(`${near}.md`));
  if (found) return { path: found, form: "relative" };
  if (!move.vault || /^\.\.?\//.test(file)) return null;
  const named = resolveWiki(index, move.root, file, doc);
  return named && { ...named, form: named.form === "path" ? "path" : "name" };
}

/** The new spelling of a link to `target` from the document at `doc`, in the
 *  form it had; `.md` kept only if it was written. */
function spell(
  after: FileIndex,
  root: string,
  target: string,
  doc: string,
  form: Form,
  withExt: boolean,
): string {
  const ext = (path: string) =>
    withExt || !isNote(target) ? path : stripNote(path);
  if (form === "relative") return ext(relativePath(dirOf(doc), target));
  const fromRoot = relativePath(root, target);
  if (form === "rooted") return `/${fromRoot}`;
  if (form === "name") {
    const bare = ext(nameOf(target));
    if (resolveWiki(after, root, bare, doc)?.path === target) return bare;
  }
  return ext(fromRoot);
}

function codeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  const visit = (node: Nodes) => {
    if (node.type === "code" || node.type === "inlineCode") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) ranges.push([start, end]);
    } else if ("children" in node) node.children.forEach(visit);
  };
  visit(fromMarkdown(text));
  return ranges;
}

function decode(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path; // not encoded
  }
}

/** One link's target in the text, and what replaces it. */
interface Edit {
  start: number;
  end: number;
  text: string;
}

// [label](target "title"), ![alt](target), and a reference definition
// `[id]: target`; the target is group 2.
const MARKDOWN_LINK =
  /(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)(?=(?:\s+"[^"\n]*")?\))|(^ {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*)(<[^>\n]+>|\S+)/gm;
// [[name#heading|label]] and ![[…]]; a `\|` in a table ends the name too.
const WIKI_LINK = /\[\[([^\]|#\n]*)(?=[#|\]])/g;

/**
 * `text`, the document that was at `doc`, with its links following `move`:
 * links to files that moved, and, when the document moved itself, its own
 * relative links. `count` is how many links changed.
 */
export function rewriteMovedLinks(
  text: string,
  doc: string,
  move: LinkMove,
): { text: string; count: number } {
  const oldDoc = sep(doc);
  const root = sep(move.root).replace(/\/+$/, "") || "/";
  const moved = (path: string) => {
    const to = move.moved(path);
    return to === null ? null : sep(to);
  };
  const files = move.files.map(sep);
  const before = new FileIndex(files);
  const after = new FileIndex(files.map((f) => moved(f) ?? f));
  const newDoc = moved(oldDoc) ?? oldDoc;
  const docMoved = newDoc !== oldDoc;
  const edits: Edit[] = [];
  const consider = (
    start: number,
    written: string,
    found: Resolved | null,
    asWritten: string,
    build: (path: string) => string,
  ) => {
    if (!found) return;
    // `.md` stays only where it was written: "[[Note v1.2]]" has none.
    const withExt =
      nameOf(found.path).toLowerCase() === nameOf(asWritten).toLowerCase();
    const target = moved(found.path) ?? found.path;
    if (!docMoved && target === found.path) return;
    const next = build(spell(after, root, target, newDoc, found.form, withExt));
    if (next !== written)
      edits.push({ start, end: start + written.length, text: next });
  };

  for (const m of text.matchAll(MARKDOWN_LINK)) {
    const target = m[2] ?? m[4];
    const start = (m.index ?? 0) + (m[1] ?? m[3]).length;
    const angle = target.startsWith("<");
    const bare = angle ? target.slice(1, -1) : target;
    if (/^[a-z][a-z0-9+.-]*:/i.test(bare) || bare.startsWith("#")) continue;
    const hash = bare.indexOf("#");
    const file = hash < 0 ? bare : bare.slice(0, hash);
    const fragment = hash < 0 ? "" : bare.slice(hash);
    const decoded = decode(file);
    if (!decoded) continue;
    const dotSlash = file.startsWith("./") ? "./" : "";
    consider(
      start,
      target,
      resolveMarkdown(before, move, decoded, oldDoc),
      decoded,
      (path) => {
        const spelled =
          (path.startsWith(".") || path.startsWith("/") ? "" : dotSlash) + path;
        return angle
          ? `<${spelled}${fragment}>`
          : spelled.replace(/ /g, "%20") + fragment;
      },
    );
  }
  for (const m of text.matchAll(WIKI_LINK)) {
    const raw = m[1];
    const name = raw.trim().replace(/\\$/, "");
    if (!name) continue; // [[#heading]] in the same note
    const start = (m.index ?? 0) + 2 + raw.indexOf(name);
    consider(
      start,
      name,
      resolveWiki(before, root, name, oldDoc),
      name,
      (path) => path,
    );
  }
  if (edits.length === 0) return { text, count: 0 };

  const code = codeRanges(text);
  const inCode = (offset: number) =>
    code.some(([s, e]) => s <= offset && offset < e);
  let out = text;
  let count = 0;
  let last = Infinity;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    if (edit.end > last || inCode(edit.start)) continue;
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    last = edit.start;
    count++;
  }
  return { text: out, count };
}

/** Where `path` went when `from` became `to` (a file, or a folder and all in it). */
export function movedBy(from: string, to: string) {
  const a = sep(from);
  const b = sep(to);
  return (path: string): string | null => {
    const p = sep(path);
    if (p === a) return b;
    return p.startsWith(`${a}/`) ? b + p.slice(a.length) : null;
  };
}

/** A document whose links a rename changed, and how many. */
export interface LinkUpdate {
  path: string;
  text: string;
  count: number;
}

/**
 * The documents whose links must follow `from` becoming `to`, worked out after
 * the move: `documents` and `files` are where they are now.
 */
export function planLinkUpdates(
  documents: { path: string; text: string }[],
  files: string[],
  options: { root: string; from: string; to: string; vault?: boolean },
): LinkUpdate[] {
  const back = movedBy(options.to, options.from);
  const oldFiles = files.map((f) => back(f) ?? sep(f));
  const from = sep(options.from);
  // A hidden or ignored file isn't indexed, but its links still count.
  if (!oldFiles.some((f) => f === from || f.startsWith(`${from}/`)))
    oldFiles.push(from);
  const move: LinkMove = {
    root: options.root,
    files: oldFiles,
    moved: movedBy(options.from, options.to),
    vault: options.vault,
  };
  const updates: LinkUpdate[] = [];
  for (const doc of documents) {
    const oldPath = back(doc.path) ?? sep(doc.path);
    const { text, count } = rewriteMovedLinks(doc.text, oldPath, move);
    if (count > 0) updates.push({ path: doc.path, text, count });
  }
  return updates;
}

/**
 * `text` (the document at `docPath`) with its links to `from` pointing at
 * `to`; the same text when none did. `files` are the folder's files before
 * the move, to tell same-named notes apart.
 */
export function rewriteLinks(
  text: string,
  docPath: string,
  from: string,
  to: string,
  files: string[] = [from],
  root: string = dirOf(sep(docPath)),
): string {
  return rewriteMovedLinks(text, docPath, {
    root,
    files: files.includes(from) ? files : [...files, from],
    moved: movedBy(from, to),
  }).text;
}
