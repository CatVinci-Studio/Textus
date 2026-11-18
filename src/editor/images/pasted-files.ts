import IMAGE_TYPES from "./image-types.json";
/**
 * Image files copied in a file manager: the clipboard holds their locations
 * (`text/uri-list`, GNOME's `x-special/gnome-copied-files`, or HTML that
 * WebKitGTK turns into `file://` links), not their bytes.
 */

/** Every picture type, by extension: one list for the editor, pasting,
 *  embeds, themes, plugins' files and the backend's vault search. */
const MIME_BY_EXT: Record<string, string> = IMAGE_TYPES;

/** The image files the image store takes, for a file picker's filter. */
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
 * The image files a paste carries, or [] when it carries anything else too.
 * `linkHrefs` are the pasted HTML's link targets, the fallback for a webview
 * that doesn't expose the URI list.
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

/**
 * What a paste carries as images, read while the paste event lasts:
 * pictures (a screenshot, a copied image), else image files copied in a
 * file manager. `linkHrefs`: the paste's only content was these links.
 */
export function clipboardImageSources(
  data: DataTransfer | null,
  linkHrefs: string[] = [],
): { files: File[]; paths: string[] } {
  const files = pastedFiles(data, (file) => file.type.startsWith("image/"));
  if (files.length > 0) return { files, paths: [] };
  const paths = imageFilesFromClipboard({
    uriList: data?.getData("text/uri-list"),
    gnomeCopiedFiles: data?.getData("x-special/gnome-copied-files"),
    linkHrefs,
  });
  return { files: [], paths };
}

/** The files a paste carries that `wanted` takes. */
function pastedFiles(
  data: DataTransfer | null,
  wanted: (file: File) => boolean,
): File[] {
  const kept = (file: File | null): file is File =>
    file !== null && wanted(file);
  const files = Array.from(data?.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter(kept);
  // Some webviews list a pasted file under `files` alone.
  return files.length ? files : Array.from(data?.files ?? []).filter(kept);
}

/**
 * What a paste carries as files of any kind (a PDF, a spreadsheet, a
 * picture), read while the paste event lasts: their bytes where the web
 * view gives them, else the files copied in a file manager, by path.
 */
export function clipboardFiles(data: DataTransfer | null): {
  files: File[];
  paths: string[];
} {
  const files = pastedFiles(data, () => true);
  if (files.length > 0) return { files, paths: [] };
  let uris = uriLines(data?.getData("text/uri-list") ?? "");
  if (uris.length === 0)
    uris = uriLines(data?.getData("x-special/gnome-copied-files") ?? "");
  const paths = uris.map(fileUrlToPath);
  return {
    files: [],
    paths: paths.every((path): path is string => path !== null) ? paths : [],
  };
}
