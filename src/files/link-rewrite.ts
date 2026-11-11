import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import {
  decodeUrlPath,
  isNoteFile,
  linkPath,
  noteStem,
  relativePath,
  slashed,
} from "../utils/path";
import { pathIndex, resolveTarget, type PathIndex } from "./link-resolve";

/**
 * Links to renamed or moved files, made to point at their new place. A link
 * changes only when it led to a file that moved, as a click reads it
 * (`resolveTarget`, the one resolver) - never because another note shares
 * its name - and only its target's characters change; every other byte
 * stays.
 */

/** A rename or move: the files there were, and where each went. */
interface LinkMove {
  /** The folder whose files are known; a wiki link's path starts here. */
  root: string;
  /** Every file under `root` before the move, absolute. */
  files: string[];
  /** Where a file went; null for one that stayed. */
  moved: (path: string) => string | null;
  /** Where a link from "/" starts (`document_link_root`); null for the
   *  disk's root. `root` when not given. */
  linkRoot?: string | null;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : "/";
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

const isRelative = (link: string) => /^\.\.?\//.test(link);

/** `link` from the folder `dir`, `.` and `..` folded. */
function join(dir: string, link: string): string {
  const parts = slashed(dir).split("/");
  for (const part of slashed(link).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/") || "/";
}

const decode = decodeUrlPath;

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

/** The folder's files before and after the move, indexed once for every
 *  document a move touches. */
interface Context {
  root: string;
  linkRoot: string | null;
  before: PathIndex;
  after: PathIndex;
  moved: (path: string) => string | null;
}

function contextOf(move: LinkMove): Context {
  const moved = (path: string) => {
    const to = move.moved(path);
    return to === null ? null : slashed(to);
  };
  const files = move.files.map(slashed);
  const root = slashed(move.root).replace(/\/+$/, "") || "/";
  const linkRoot = move.linkRoot === undefined ? root : move.linkRoot;
  return {
    root,
    linkRoot: linkRoot === null ? null : slashed(linkRoot).replace(/\/+$/, ""),
    before: pathIndex(root, files),
    after: pathIndex(
      root,
      files.map((f) => moved(f) ?? f),
    ),
    moved,
  };
}

/** The existing file `link` (as written) leads to from `doc`, as a click
 *  takes it. */
function existing(index: PathIndex, link: string, doc: string): string | null {
  const target = resolveTarget(index, link, doc);
  return target?.exists ? target.path : null;
}

/** How a link names its file, so the new link is written the same way. */
type Form = "relative" | "name" | "path";

/** One link's target in the text, and what replaces it. */
interface Edit {
  start: number;
  end: number;
  text: string;
}

// [label](target "title"), ![alt](target), and a reference definition
// `[id]: target` (not a footnote's); the target is group 2 or 4.
const MARKDOWN_LINK =
  /(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)(?=(?:\s+"[^"\n]*")?\))|(^ {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*)(<[^>\n]+>|\S+)/gm;
// [[name#heading|label]] and ![[…]]; a `\|` in a table ends the name too.
const WIKI_LINK = /\[\[([^\]|#\n]*)(?=[#|\]])/g;

function rewriteWith(
  text: string,
  doc: string,
  ctx: Context,
): { text: string; count: number } {
  const { before, after, moved, root } = ctx;
  const oldDoc = slashed(doc);
  const newDoc = moved(oldDoc) ?? oldDoc;
  const docMoved = newDoc !== oldDoc;
  const oldDir = dirOf(oldDoc);
  const newDir = dirOf(newDoc);
  const edits: Edit[] = [];
  const edit = (start: number, written: string, next: string | null) => {
    if (next !== null && next !== written)
      edits.push({ start, end: start + written.length, text: next });
  };
  // `.md` stays only where it was written: "[[Note v1.2]]" has none.
  const spelling = (target: string, found: string, written: string) =>
    nameOf(found).toLowerCase() === nameOf(written).toLowerCase() ||
    !isNoteFile(target)
      ? (path: string) => path
      : noteStem;

  /** A Markdown link's new path, or null to leave it. */
  const markdownTarget = (file: string, decoded: string): string | null => {
    if (decoded.startsWith("/") || /^[a-z]:\//i.test(decoded)) {
      const base = decoded.startsWith("/") ? ctx.linkRoot : null;
      const full = base === null ? decoded : `${base}${decoded}`;
      // Only a file of the folder is known; it is looked up as "/" from it.
      if (full !== root && !full.startsWith(`${root}/`)) return null;
      const found = existing(before, `/${relativePath(root, full)}`, oldDoc);
      const target = found && moved(found);
      if (!target) return null;
      return base === null ? target : `/${relativePath(base, target)}`;
    }
    const direct = isRelative(file) ? file : `./${file}`;
    let found = existing(before, direct, oldDoc);
    let form: Form = "relative";
    if (!found) {
      found = existing(before, file, oldDoc);
      form = "name";
    }
    // A link to nothing still leads to the same place from a moved document.
    if (!found && !docMoved) return null;
    found ??= join(oldDir, decoded);
    const target = moved(found) ?? found;
    if (!docMoved && target === found) return null;
    const leads =
      form === "relative"
        ? existing(after, direct, newDoc)
        : existing(after, file, newDoc);
    if (leads === target) return null;
    const ext = spelling(target, found, decoded);
    if (form === "name") {
      const bare = ext(nameOf(target));
      if (existing(after, bare, newDoc) === target) return bare;
    }
    const path = ext(relativePath(newDir, target));
    return file.startsWith("./") && !path.startsWith(".") ? `./${path}` : path;
  };

  for (const m of text.matchAll(MARKDOWN_LINK)) {
    const written = m[2] ?? m[4];
    const start = (m.index ?? 0) + (m[1] ?? m[3]).length;
    const angle = written.startsWith("<");
    const bare = angle ? written.slice(1, -1) : written;
    const scheme =
      /^[a-z][a-z0-9+.-]*:/i.test(bare) && !/^[a-z]:[\\/]/i.test(bare);
    if (scheme || bare.startsWith("#")) continue;
    const hash = bare.indexOf("#");
    const file = hash < 0 ? bare : bare.slice(0, hash);
    const fragment = hash < 0 ? "" : bare.slice(hash);
    const decoded = slashed(decode(file));
    if (!decoded) continue;
    const path = markdownTarget(file, decoded);
    edit(
      start,
      written,
      path === null
        ? null
        : angle
          ? `<${path}${fragment}>`
          : linkPath(path) + fragment,
    );
  }

  for (const m of text.matchAll(WIKI_LINK)) {
    const raw = m[1];
    const name = raw.trim().replace(/\\$/, "");
    if (!name) continue; // [[#heading]] in the same note
    const start = (m.index ?? 0) + 2 + raw.indexOf(name);
    const found = existing(before, `[[${name}]]`, oldDoc);
    if (!found) continue;
    const target = moved(found) ?? found;
    if (!docMoved && target === found) continue;
    if (existing(after, `[[${name}]]`, newDoc) === target) continue;
    const ext = spelling(target, found, name);
    const form: Form = isRelative(name)
      ? "relative"
      : name.includes("/")
        ? "path"
        : "name";
    let next: string;
    if (form === "relative") {
      const path = ext(relativePath(newDir, target));
      next = path.startsWith(".") ? path : `./${path}`;
    } else {
      const short = ext(nameOf(target));
      next =
        form === "name" && existing(after, `[[${short}]]`, newDoc) === target
          ? short
          : ext(relativePath(root, target));
    }
    edit(start, name, next);
  }
  if (edits.length === 0) return { text, count: 0 };

  const code = codeRanges(text);
  const inCode = (offset: number) =>
    code.some(([s, e]) => s <= offset && offset < e);
  let out = text;
  let count = 0;
  let last = Infinity;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    if (e.end > last || inCode(e.start)) continue;
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    last = e.start;
    count++;
  }
  return { text: out, count };
}

/** Where `path` went when `from` became `to` (a file, or a folder and all in it). */
export function movedBy(from: string, to: string) {
  const a = slashed(from);
  const b = slashed(to);
  return (path: string): string | null => {
    const p = slashed(path);
    if (p === a) return b;
    return p.startsWith(`${a}/`) ? b + p.slice(a.length) : null;
  };
}

/** A document whose links a rename changed, and how many. */
interface LinkUpdate {
  path: string;
  text: string;
  count: number;
}

interface LinkPlan {
  root: string;
  from: string;
  to: string;
  linkRoot?: string | null;
}

/**
 * What `from` becoming `to` does to one document's links, worked out after
 * the move: `files` and the document's path are where they are now. Null
 * when none change. Built once, it is asked again for each document.
 */
export function linkPlanner(
  files: string[],
  plan: LinkPlan,
): (doc: { path: string; text: string }) => LinkUpdate | null {
  const back = movedBy(plan.to, plan.from);
  const oldFiles = files.map((f) => back(f) ?? slashed(f));
  const from = slashed(plan.from);
  // A hidden or ignored file isn't indexed, but its links still count.
  if (!oldFiles.some((f) => f === from || f.startsWith(`${from}/`)))
    oldFiles.push(from);
  const ctx = contextOf({
    root: plan.root,
    files: oldFiles,
    moved: movedBy(plan.from, plan.to),
    linkRoot: plan.linkRoot,
  });
  return (doc) => {
    const oldPath = back(doc.path) ?? slashed(doc.path);
    const { text, count } = rewriteWith(doc.text, oldPath, ctx);
    return count > 0 ? { path: doc.path, text, count } : null;
  };
}
