// OS-path string math. Documents opened on Windows arrive with "\", so both
// separators are treated as separators here.

export function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const name = idx >= 0 ? path.slice(idx + 1) : path;
  // A document picked on iOS is a file:// URL with an encoded name.
  return path.startsWith("file://") ? decodeUrlPath(name) : name;
}

// The folder part of a path: "/" for a root-level "/name", and the input
// unchanged for a bare filename.
/** A file's extension with its dot (".pdf"), or "" for none. */
export function extname(path: string): string {
  return /\.[^./\\]+$/.exec(path)?.[0] ?? "";
}

export function dirname(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (idx > 0) return path.slice(0, idx);
  return idx === 0 ? path[0] : path;
}

// The folder one level up, or null at a filesystem or UNC share root.
export function parentDir(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (idx < 0) return null;
  const parent = trimmed.slice(0, idx);
  if (parent === "") return "/";
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
  if (/^\\\\[^\\]*$/.test(parent)) return null;
  return parent;
}

/** Whether `path` lies under `dir`, its "." and ".." walked first: a path
 *  climbing out with ".." is outside, however it starts. */
export function isInside(path: string, dir: string): boolean {
  const inner = walked(path);
  const outer = walked(dir);
  if (inner === null || outer === null || inner === outer) return false;
  return inner.startsWith(outer.endsWith("/") ? outer : `${outer}/`);
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

// A Windows drive path, "C:\..." or "C:/...". Test it before hasUrlScheme,
// which reads the drive letter as a one-letter scheme.
export function isDrivePath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path);
}

// Whether a link or image src starts with a URL scheme (http:, data:,
// asset:, file:, ...) rather than being a path.
export function hasUrlScheme(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(src);
}

/** `path` with "/" between its parts, as links and the folder index keep it. */
export const slashed = (path: string): string => path.replace(/\\/g, "/");

/** A Markdown document's extensions: what Textus opens and plugins read as
 *  one. The backend's list (extract::MARKDOWN_EXTENSIONS) is the same. */
export const MARKDOWN_EXTENSIONS = ["md", "markdown"] as const;
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
