import { dirname, isInside } from "../utils/path";

/** Whether `path` is folder `dir` itself or lies somewhere below it. */
export function isWithin(path: string, dir: string): boolean {
  return path === dir || isInside(path, dir);
}

/**
 * Where the file tree is rooted after the front document or opened folder
 * changes. An opened folder holds the tree; otherwise it stays while the
 * document is inside it. A draft shows `fallback`, or leaves the tree.
 */
export function nextTreeRoot({
  current,
  folder,
  docPath,
  fallback,
}: {
  current: string | null;
  folder: string | null;
  docPath: string | null;
  fallback: string | null;
}): string | null {
  if (folder) {
    if (!current || !isWithin(current, folder)) return folder;
    if (docPath && isInside(docPath, folder) && !isInside(docPath, current))
      return folder;
    return current;
  }
  if (!docPath) return fallback ?? current;
  if (current && isInside(docPath, current)) return current;
  return dirname(docPath);
}

/**
 * The AI's project folder once a folder is opened, or null to leave it. It
 * follows the opened folder unless the user chose one for the AI.
 */
export function agentRootOnOpen(
  current: string,
  fromFolder: string,
  opened: string,
): string | null {
  if (current === opened) return null;
  return current === "" || current === fromFolder ? opened : null;
}

/** The same on Close Folder: back to "" if this folder set the AI's
 *  folder, else null to leave it. */
export function agentRootOnClose(
  current: string,
  fromFolder: string,
  closed: string,
): string | null {
  return current !== "" && current === fromFolder && closed === fromFolder
    ? ""
    : null;
}
