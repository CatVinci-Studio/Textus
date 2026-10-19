// OS-path string math shared across the frontend. A path may use either
// separator - documents opened on Windows arrive with "\" while everything
// else uses "/" - so both are treated as separators here (see commit
// 030e9a2). Note theme-import.ts keeps its own dirnameOf: it needs ""
// (not the input) for a separator-less path, feeding its resolvePath.

export function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const name = idx >= 0 ? path.slice(idx + 1) : path;
  // A document picked on iOS is a file:// URL - "My%20Notes.md" on disk
  // is "My Notes.md".
  return path.startsWith("file://") ? decodeUrlPath(name) : name;
}

// The folder part of a path: "/" for a root-level "/name" (returning the
// input there made image paths like "/name.md/img.png"), and the input
// unchanged for a bare filename with no folder at all.
export function dirname(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (idx > 0) return path.slice(0, idx);
  return idx === 0 ? path[0] : path;
}

// The folder one level up, or null at a filesystem root ("/", "C:\") or a
// UNC share root ("\\server\share"), where there is nothing above to list.
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

// Whether `path` lies somewhere below folder `dir` (not equal to it).
export function isInside(path: string, dir: string): boolean {
  if (!path.startsWith(dir) || path.length === dir.length) return false;
  return /[\\/]$/.test(dir) || /[\\/]/.test(path[dir.length]);
}

// A Markdown image or link destination is a URL, so other apps write a
// space as "%20" (and Chinese as "%E5%9B%BE..."); the file on disk has the
// decoded name. Undecoded, an image's "%20" reached the asset protocol as
// "%2520" and found nothing (#135). A malformed escape (a file really named
// "100%.png") is kept as written.
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

/** Whether two paths name the same file, written either way: Rust joins a
 *  Windows path with "\" while a path typed into a setting may say "/",
 *  and a drive letter (and NTFS) ignores case. Elsewhere only the
 *  separators are folded - other file systems may well tell case apart. */
export function samePath(a: string, b: string): boolean {
  const fold = (p: string) => {
    const slashes = p.replace(/\\/g, "/").replace(/\/+$/, "");
    return isDrivePath(p) ? slashes.toLowerCase() : slashes;
  };
  return fold(a) === fold(b);
}
