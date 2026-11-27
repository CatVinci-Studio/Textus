import { MARKDOWN_EXTENSIONS } from "../platform/bindings/files";
// OS-path string math. Documents opened on Windows arrive with "\", so both
// separators are treated as separators here.

/** Android's content:// URLs carry no readable name: the picker's and the
 *  folder listing's names, by URL (platform/native-files.ts). */
const contentNames = new Map<string, string>();

export function nameContentUrl(url: string, name: string): void {
  contentNames.set(url, name);
}

export function basename(path: string): string {
  if (path.startsWith("content://")) return contentName(path);
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const name = idx >= 0 ? path.slice(idx + 1) : path;
  // A document picked on iOS is a file:// URL with an encoded name.
  return path.startsWith("file://") ? decodeUrlPath(name) : name;
}

/** A content:// URL's name: as picked or listed, else its document id's
 *  last part (external storage's "primary:Notes/a.md"). */
function contentName(url: string): string {
  const named = contentNames.get(url);
  if (named) return named;
  const id = decodeUrlPath(url.slice(url.lastIndexOf("/") + 1));
  return id.slice(Math.max(id.lastIndexOf("/"), id.lastIndexOf(":")) + 1);
}

// The folder part of a path: "/" for a root-level "/name", and the input
// unchanged for a bare filename.
/** A file's extension with its dot (".pdf"), or "" for none. */
export function extname(path: string): string {
  return /\.[^./\\]+$/.exec(path)?.[0] ?? "";
}

export function dirname(path: string): string {
  const content = contentParent(path);
  if (content) return content;
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (idx > 0) return path.slice(0, idx);
  return idx === 0 ? path[0] : path;
}

// The folder one level up, or null at a filesystem or UNC share root.
export function parentDir(path: string): string | null {
  if (path.startsWith("content://")) return contentParent(path);
  const trimmed = path.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (idx < 0) return null;
  const parent = trimmed.slice(0, idx);
  if (parent === "") return "/";
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
  if (/^\\\\[^\\]*$/.test(parent)) return null;
  return parent;
}

/** An Android picked folder's entry's folder: its document id
 *  ("primary:Notes/a.md", "/" spelled %2F) a part shorter, in the same
 *  tree; null at the tree's top or for another kind of URL. */
function contentParent(url: string): string | null {
  const at = url.indexOf("/document/");
  if (!url.startsWith("content://") || at < 0) return null;
  const id = decodeUrlPath(url.slice(at + "/document/".length));
  const cut = id.lastIndexOf("/");
  if (cut < 0) return null;
  return `${url.slice(0, at)}/document/${encodeURIComponent(id.slice(0, cut))}`;
}

const DOCUMENT = "/document/";

/** An Android picked folder's entry `rel` ("inbox/a.md") below folder
 *  `dir`: the folder's document id and the path under it, as its listing
 *  spells them ("primary:Notes/inbox/a.md", "/" as %2F). */
export function contentJoin(dir: string, rel: string): string {
  const at = dir.indexOf(DOCUMENT);
  const parts = rel.split(/[\\/]/).filter((p) => p !== "" && p !== ".");
  if (at < 0 || !parts.length) return dir;
  const id = decodeUrlPath(dir.slice(at + DOCUMENT.length)).replace(/\/$/, "");
  const url = `${dir.slice(0, at)}${DOCUMENT}${encodeURIComponent(`${id}/${parts.join("/")}`)}`;
  nameContentUrl(url, parts[parts.length - 1]!);
  return url;
}

/** `path` as a path below Android picked folder `dir` ("inbox/a.md"); null
 *  for one that isn't under it. */
export function contentRelative(dir: string, path: string): string | null {
  if (!contentInside(path, dir)) return null;
  const id = (url: string) =>
    decodeUrlPath(url.slice(url.indexOf(DOCUMENT) + DOCUMENT.length));
  return id(path).slice(id(dir).replace(/\/$/, "").length + 1);
}

/** Whether `path` lies under `dir`, its "." and ".." walked first: a path
 *  climbing out with ".." is outside, however it starts. */
export function isInside(path: string, dir: string): boolean {
  if (path.startsWith("content://") || dir.startsWith("content://"))
    return contentInside(path, dir);
  const inner = walked(path);
  const outer = walked(dir);
  if (inner === null || outer === null || inner === outer) return false;
  return inner.startsWith(outer.endsWith("/") ? outer : `${outer}/`);
}

/** Whether `path` is folder `dir` itself or lies somewhere below it,
 *  however its separators are written. */
export function isWithin(path: string, dir: string): boolean {
  return samePath(path, dir) || isInside(path, dir);
}

/** Whether `a` and `b` name one path: separators and "." and ".." aside. */
function samePath(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.startsWith("content://") || b.startsWith("content://")) return false;
  const walkedA = walked(a);
  return walkedA !== null && walkedA === walked(b);
}

/** `path` after `from` (itself or a folder holding it) moved to `to`;
 *  null when it isn't within `from`. */
export function movedTo(path: string, from: string, to: string): string | null {
  if (samePath(path, from)) return to;
  if (!isInside(path, from)) return null;
  const rest = slashed(path).slice(slashed(from).replace(/\/+$/, "").length);
  return rest.split("/").filter(Boolean).reduce(joinPath, to);
}

/** An Android picked folder's entry: under the same picked tree, its
 *  document id ("primary:Notes/a.md", "/" spelled %2F) below the folder's. */
function contentInside(path: string, dir: string): boolean {
  const split = (url: string) => {
    const at = url.indexOf("/document/");
    return at < 0
      ? null
      : {
          tree: url.slice(0, at),
          id: decodeUrlPath(url.slice(at + "/document/".length)),
        };
  };
  const inner = split(path);
  const outer = split(dir);
  if (!inner || !outer || inner.tree !== outer.tree) return false;
  if (inner.id.split("/").includes("..")) return false;
  return inner.id.startsWith(
    outer.id.endsWith("/") ? outer.id : `${outer.id}/`,
  );
}

/** A test for whether a path is one of `targets` or a folder holding one,
 *  their folders worked out once rather than per path asked about. */
export function onTheWay(
  ...targets: (string | null | undefined)[]
): (path: string) => boolean {
  const way = new Set<string>();
  for (const target of targets) {
    let p = target ? walked(target) : null;
    for (let i: number; p; p = i > 0 ? p.slice(0, i) : null) {
      way.add(p);
      i = p.lastIndexOf("/");
    }
  }
  return (path) => way.has(walked(path) ?? "");
}

/** A path with "/" for each separator and its "." and ".." walked; null
 *  when ".." climbs above its root. */
function walked(path: string): string | null {
  const root = /^(?:[A-Za-z]:)?[\\/]*/.exec(path)![0].replace(/\\/g, "/");
  const parts: string[] = [];
  for (const part of path.slice(root.length).split(/[\\/]+/)) {
    if (part === "" || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (parts.pop() === undefined) return null;
  }
  return root + parts.join("/");
}

// A Markdown image or link destination is a URL, so "%20" names a space in
// the file on disk. A malformed escape (a file named "100%.png") is kept.
export function decodeUrlPath(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
}

/** A path as a Markdown link's destination, as the Rust side writes one
 *  (markdown_path): `%`, space, `(`, `)` and `#` escaped, so it needs no
 *  angle brackets and decodeUrlPath reads it back as written. */
export function linkPath(path: string): string {
  return path.replace(
    /[% ()#]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

// A Windows drive path, "C:\..." or "C:/...". Test it before hasUrlScheme,
// which reads the drive letter as a one-letter scheme.
export function isDrivePath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path);
}

/** The local path a `file:` URL names (`file:///D:/a b.png` → `D:/a b.png`,
 *  `file:///Users/x.png` → `/Users/x.png`), or null: not a file: URL, or
 *  one naming another machine (`file://host/…`, `file:////host/…`, a
 *  `\\host` share), which is never read. */
export function fileUrlPath(src: string): string | null {
  const url = /^file:(?:\/\/(?:localhost)?)?(.*)$/i.exec(src.trim());
  if (!url) return null;
  const rest = url[1];
  const named = isDrivePath(rest)
    ? rest
    : /^\/[^/\\]/.test(rest)
      ? rest.slice(1)
      : null;
  if (named === null) return null;
  const path = decodeUrlPath(named);
  if (isDrivePath(path)) return path;
  return /^[/\\]/.test(path) ? null : `/${path}`;
}

/** `link` with a `file:` URL written as the plain path it names, anchor
 *  kept, so it is followed like that path; any other link as it is. */
export function fileUrlAsLink(link: string): string {
  const hash = link.indexOf("#");
  const path = fileUrlPath(hash < 0 ? link : link.slice(0, hash));
  return path === null
    ? link
    : linkPath(path) + (hash < 0 ? "" : link.slice(hash));
}

// Whether a link or image src starts with a URL scheme (http:, data:,
// asset:, file:, ...) rather than being a path.
export function hasUrlScheme(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(src);
}

/** `path` with "/" between its parts, as links and the folder index keep it. */
export const slashed = (path: string): string => path.replace(/\\/g, "/");

/** A real file's path with "/": a Windows path's "\\" is a separator, but
 *  on macOS and Linux it is part of a name (`a\\b.md` is one file). */
export const realSlashed = (path: string): string =>
  /^(?:[A-Za-z]:|\\\\)/.test(path) ? slashed(path) : path;

const NOTE_FILE = new RegExp(`\\.(${MARKDOWN_EXTENSIONS.join("|")})$`, "i");

/** A note: a Markdown file, which a wikilink names without its extension. */
export const isNoteFile = (path: string): boolean => NOTE_FILE.test(path);

/** `path` without a note's extension (`a/Note.md` → `a/Note`). */
export const noteStem = (path: string): string => path.replace(NOTE_FILE, "");

/** `to`, written relative to the folder `fromDir`, with "/". */
export function relativePath(fromDir: string, to: string): string {
  const a = slashed(fromDir).split("/").filter(Boolean);
  const b = slashed(to).split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const up = a.slice(i).map(() => "..");
  return [...up, ...b.slice(i)].join("/") || ".";
}

/** A folder's name as shown: its last part, or the whole path for a
 *  disk's root ("/", "C:\\"). */
export function folderName(path: string): string {
  return basename(path.replace(/[\\/]+$/, "")) || path;
}

/** `name` inside `dir`, with the separator `dir` is written with (a
 *  Windows path only when it has no "/"). */
export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return `${dir.replace(/[\\/]+$/, "")}${sep}${name.replace(/^[\\/]+/, "")}`;
}

/** `path` inside `dir` when it is relative (a plugin's folder-relative
 *  path, one typed in a terminal), written with `dir`'s separator and no
 *  leading "./", as the file tree has it; an absolute path as it is. */
export function absoluteIn(dir: string, path: string): string {
  if (/^([\\/]|[A-Za-z]:[\\/])/.test(path) || path.startsWith("content://"))
    return path;
  if (dir.startsWith("content://")) return contentJoin(dir, path);
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  // On macOS and Linux a backslash is part of a name, not a separator.
  if (sep === "/") return joinPath(dir, path.replace(/^(\.\/)+/, ""));
  return joinPath(dir, path.replace(/^(\.[\\/])+/, "").replace(/\//g, sep));
}
