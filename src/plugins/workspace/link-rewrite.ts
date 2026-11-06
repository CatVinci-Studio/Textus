import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import { basename, dirname } from "../../utils/path";
import { pathIndex, resolveTarget, type PathIndex } from "./metadata-cache";

/**
 * Links to a renamed or moved file, made to point at its new place. A link
 * changes only when it led to that very file, as a click reads it - never
 * because another note shares its name - and only its target's characters
 * change. Anything else is left exactly as it was.
 */

function sep(path: string): string {
  return path.replace(/\\/g, "/");
}

/** `to`, written relative to the folder `fromDir`. */
export function relativePath(fromDir: string, to: string): string {
  const a = sep(fromDir).split("/").filter(Boolean);
  const b = sep(to).split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const up = a.slice(i).map(() => "..");
  return [...up, ...b.slice(i)].join("/") || ".";
}

/** Where a relative link from a document in `docDir` leads. */
function resolveFrom(docDir: string, link: string): string {
  const parts = sep(docDir).split("/");
  for (const part of sep(link).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

const MARKDOWN = /\.(md|markdown)$/i;

function stem(name: string): string {
  return name.replace(MARKDOWN, "");
}

function encodeLink(path: string): string {
  return path.replace(/ /g, "%20");
}

function decoded(link: string): string {
  try {
    return decodeURI(link);
  } catch {
    return link;
  }
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

/** The folder's notes before the rename and after it, for telling which
 *  links led to the file and how to spell the new one; and the folder a
 *  link from "/" is read from, if any. */
export interface RenameContext {
  before: PathIndex;
  after: PathIndex;
  linkRoot: string | null;
}

/** The context for renaming `from` to `to` in the folder `root`, whose
 *  documents are now at `paths`. */
export function renameContext(
  root: string,
  paths: readonly string[],
  from: string,
  to: string,
  linkRoot: string | null,
): RenameContext {
  const after = paths.includes(to) ? [...paths] : [...paths, to];
  return {
    before: pathIndex(
      root,
      after.map((p) => (p === to ? from : p)),
    ),
    after: pathIndex(root, after),
    linkRoot,
  };
}

const MD_LINK = /(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?\))/g;
const WIKI_LINK = /(!?)\[\[([^[\]\n]+)\]\]/g;

/** `replace` on `text`'s Markdown links' targets outside code: given the
 *  target as written (without <>), it returns the new one or null. */
function eachMarkdownLink(
  text: string,
  replace: (bare: string) => string | null,
): string {
  const code = codeRanges(text);
  return text.replace(
    MD_LINK,
    (all, open: string, target: string, close: string, offset: number) => {
      if (code.some(([s, e]) => s <= offset && offset < e)) return all;
      const angled = target.startsWith("<");
      const bare = angled ? target.slice(1, -1) : target;
      if (/^[a-z][a-z0-9+.-]*:/i.test(bare) || bare.startsWith("#")) return all;
      const next = replace(bare);
      if (next === null) return all;
      return `${open}${angled ? `<${next}>` : encodeLink(next)}${close}`;
    },
  );
}

/**
 * `text` (the document at `docPath`) with its links to `from` pointing at
 * `to`; the same text when none did.
 */
export function rewriteLinks(
  text: string,
  docPath: string,
  from: string,
  to: string,
  context: RenameContext,
): string {
  const docDir = sep(dirname(docPath));
  const oldPath = sep(from);
  const leadsThere = (written: string) =>
    resolveTarget(context.before, written, docPath)?.path === oldPath;
  const root = context.linkRoot && sep(context.linkRoot).replace(/\/+$/, "");
  let out = eachMarkdownLink(text, (bare) => {
    const [file, hash = ""] = bare.split(/(?=#)/);
    const path = decoded(file);
    // From "/" when a project root reads it so, kept that way.
    if (path.startsWith("/") && root) {
      if (`${root}${path}` !== oldPath) return null;
      return `/${relativePath(root, sep(to))}${hash}`;
    }
    const direct = resolveFrom(docDir, path) === oldPath;
    if (!direct && !(MARKDOWN.test(oldPath) && leadsThere(bare))) return null;
    // Written without ".md" (`[t](Note)`), it stays without.
    const next = relativePath(docDir, sep(to));
    return (
      (MARKDOWN.test(path) || !MARKDOWN.test(next) ? next : stem(next)) + hash
    );
  });
  if (out !== text) text = out;
  const code = codeRanges(text);
  out = text.replace(
    WIKI_LINK,
    (all, bang: string, inner: string, offset: number) => {
      if (code.some(([s, e]) => s <= offset && offset < e)) return all;
      if (!leadsThere(all)) return all;
      // Only the name changes: its "#heading", "|alias" (or a table's "\|")
      // stay byte for byte.
      const end = inner.search(/#|\\?\|/);
      const name = (end < 0 ? inner : inner.slice(0, end)).trim();
      const rest = end < 0 ? "" : inner.slice(end);
      return `${bang}[[${wikiName(name, docPath, to, context)}${rest}]]`;
    },
  );
  return out;
}

/** How a wiki link names `to` from `docPath`: by its name alone when that
 *  finds it, else by its path from the root; ".md" kept when it was written. */
function wikiName(
  written: string,
  docPath: string,
  to: string,
  { after }: RenameContext,
): string {
  const withExt = MARKDOWN.test(written) || !MARKDOWN.test(to);
  const name = basename(to);
  const short = withExt ? name : stem(name);
  if (
    !written.includes("/") &&
    resolveTarget(after, `[[${short}]]`, docPath)?.path === sep(to)
  )
    return short;
  const rel = relativePath(after.root, sep(to));
  return withExt ? rel : stem(rel);
}

/**
 * The text of a document moved from `from` to `to`, its relative Markdown
 * links and pictures made to lead where they led before. Wiki links (by
 * name, from the vault) and links from "/" don't move with it.
 */
export function rebaseLinks(text: string, from: string, to: string): string {
  const oldDir = sep(dirname(from));
  const newDir = sep(dirname(to));
  if (oldDir === newDir) return text;
  return eachMarkdownLink(text, (bare) => {
    const [file, hash = ""] = bare.split(/(?=#)/);
    const path = decoded(file);
    if (!path || path.startsWith("/") || /^[a-z]:/i.test(path)) return null;
    return relativePath(newDir, resolveFrom(oldDir, path)) + hash;
  });
}
