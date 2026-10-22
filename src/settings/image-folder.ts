/** `imageFolder` when images go in the document's own folder; any other
 *  value names a subfolder of it (Settings > Images > Folder). */
export const SAME_FOLDER = "./";

/** The subfolder a new installation uses, and the one a setting that
 *  can't be kept becomes. */
export const DEFAULT_IMAGE_SUBFOLDER = "assets";

/**
 * The folder as the Markdown names it - relative to the document, with
 * forward slashes, "" for the document's own folder - or null for a
 * setting the backend refuses: empty, absolute, a drive, an empty segment
 * ("img//x") or one that climbs out with "..". Mirrors ImageFolder::resolve
 * in src-tauri/src/commands/fs.rs, which is what decides where images go -
 * a change to one is a change to both.
 */
function imageFolderPrefix(setting: string): string | null {
  const trimmed = setting.trim();
  if (!trimmed || /^[\\/]|^[a-z]:/i.test(trimmed)) return null;
  const segments = trimmed.split(/[\\/]/);
  const parts: string[] = [];
  for (const [i, segment] of segments.entries()) {
    // A trailing slash: "./", "img/".
    if (segment === "" && i > 0 && i === segments.length - 1) continue;
    if (segment === "" || segment === "..") return null;
    if (segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}

/** The src a pasted `name` gets with this image folder setting, for the
 *  example under the choice; null for a setting the backend refuses. */
export function imageFolderExample(
  folder: string,
  name: string,
): string | null {
  const prefix = imageFolderPrefix(folder);
  if (prefix === null) return null;
  return prefix ? `${prefix}/${name}` : name;
}

/** Whether `name`, as typed, is a subfolder of the document's folder (and
 *  not that folder itself, which is the other choice). */
export function isImageSubfolder(name: string): boolean {
  return !!imageFolderPrefix(name);
}

/**
 * A stored `imageFolder` as one of the two choices Settings offers: the
 * document's folder, or one subfolder. A folder of the user's own is kept
 * when it is a single plain name; a pattern, a path or anything the
 * backend refuses (a hand edit) becomes "assets".
 */
export function storedImageFolder(stored: unknown): string {
  if (typeof stored !== "string") return DEFAULT_IMAGE_SUBFOLDER;
  const prefix = imageFolderPrefix(stored);
  if (prefix === "") return SAME_FOLDER;
  if (prefix && !prefix.includes("/") && !prefix.includes("${")) return prefix;
  return DEFAULT_IMAGE_SUBFOLDER;
}
