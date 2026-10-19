/**
 * Image files copied in a file manager. What lands on the clipboard is the
 * files' locations, not their bytes: `text/uri-list` (every desktop),
 * GNOME Files' own `x-special/gnome-copied-files` ("copy" or "cut", then
 * one URI a line), and an HTML or plain-text rendering of the same paths.
 * WebKitGTK turns the latter into a `file://` link, which is what a paste
 * used to insert (issue #59) - `[/home/me/x.png](file:///home/me/x.png)`.
 */

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
};

/** The image files the image store takes (image-plugin.ts's storeImage),
 *  for a file picker's filter. */
export const IMAGE_FILE_EXTENSIONS = Object.keys(MIME_BY_EXT);

/** The image type a file's extension names, or null if it isn't one. */
export function imageMimeForPath(path: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return (ext && MIME_BY_EXT[ext]) ?? null;
}

/** A local `file://` URL as a filesystem path; null for anything else,
 *  remote hosts (`file://server/share`) included. */
export function fileUrlToPath(url: string): string | null {
  const match = /^file:\/\/(localhost)?(\/.*)$/i.exec(url.trim());
  if (!match) return null;
  let path: string;
  try {
    path = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  // file:///C:/x - a Windows drive path keeps no leading slash.
  return /^\/[a-z]:\//i.test(path) ? path.slice(1) : path;
}

/** The URIs in a `text/uri-list` or GNOME's copied-files list. */
function uriLines(list: string): string[] {
  return list
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && /^[a-z]+:/i.test(line));
}

/**
 * The image files a paste carries, or [] when it carries anything else as
 * well: a copied PDF beside a screenshot stays a pasted link, as before,
 * rather than having only part of the selection turn into images.
 * `linkHrefs` are the targets of the links the pasted HTML parsed into,
 * when that is all it holds - the fallback for a webview that doesn't
 * expose the URI list itself.
 */
export function imageFilesFromClipboard(clipboard: {
  uriList?: string;
  gnomeCopiedFiles?: string;
  linkHrefs?: string[];
}): string[] {
  let uris = uriLines(clipboard.uriList ?? "");
  if (uris.length === 0) uris = uriLines(clipboard.gnomeCopiedFiles ?? "");
  if (uris.length === 0) uris = clipboard.linkHrefs ?? [];
  if (uris.length === 0) return [];
  const paths = uris.map(fileUrlToPath);
  return paths.every(
    (path): path is string => path !== null && imageMimeForPath(path) !== null,
  )
    ? paths
    : [];
}
