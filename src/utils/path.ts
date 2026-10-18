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
  if (!path.startsWith("file://")) return name;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
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

/** A Markdown image destination may be percent-encoded ("Application%20Support");
 *  convertFileSrc encodes again, so local paths are decoded first. */
export function decodeLocalPath(src: string): string {
  try {
    return decodeURI(src);
  } catch {
    return src;
  }
}
