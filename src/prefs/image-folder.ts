/** `imageFolder` when images go in the document's own folder; any other
 *  value names a subfolder of it (Settings > Images > Folder). */
export const SAME_FOLDER = "./";

/** The subfolder a new installation uses, and the one a setting that
 *  can't be kept becomes. */
export const DEFAULT_IMAGE_SUBFOLDER = "assets";

/**
 * The folder as the Markdown names it (relative, forward slashes, "" for the
 * document's own folder), or null for a setting the backend refuses. Keep in
 * step with the backend's ImageFolder::resolve, which decides where images go.
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

/** A stored `imageFolder` as one of Settings' two choices: the document's
 *  folder, or one plain subfolder name; anything else becomes "assets". */
export function storedImageFolder(stored: unknown): string {
  if (typeof stored !== "string") return DEFAULT_IMAGE_SUBFOLDER;
  const prefix = imageFolderPrefix(stored);
  if (prefix === "") return SAME_FOLDER;
  if (prefix && !prefix.includes("/") && !prefix.includes("${")) return prefix;
  return DEFAULT_IMAGE_SUBFOLDER;
}
