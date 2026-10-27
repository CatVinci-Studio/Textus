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

export function isInside(path: string, dir: string): boolean {
  if (!path.startsWith(dir) || path.length === dir.length) return false;
  return /[\\/]$/.test(dir) || /[\\/]/.test(path[dir.length]);
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
