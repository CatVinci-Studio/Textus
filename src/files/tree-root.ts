import { dirname, isInside } from "../utils/path";

/** Whether `path` is folder `dir` itself or lies somewhere below it. */
export function isWithin(path: string, dir: string): boolean {
  return path === dir || isInside(path, dir);
}

/**
 * Where the file tree is rooted after the front document or opened folder
 * changes. An opened folder is always the root; otherwise it stays while
 * the document is inside it. A draft shows `fallback`, or leaves the tree.
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
  // An opened folder is the tree's root, whole, as a project is.
  if (folder) return folder;
  if (!docPath) return fallback ?? current;
  // A document Android granted alone (content://) has no folder to list.
  if (docPath.startsWith("content://")) return current ?? fallback;
  if (current && isInside(docPath, current)) return current;
  return dirname(docPath);
}

/** The root after Close Folder: the front document's own folder again. */
export function rootAfterClose(
  docPath: string | null,
  fallback: string | null,
): string | null {
  return nextTreeRoot({ current: null, folder: null, docPath, fallback });
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

/**
 * The AI's folder and the folder that set it, after a reinstall moved the
 * app's Documents (iOS): each in this install's Documents, or null when
 * neither moved.
 */
export function agentRootsMoved(
  current: string,
  fromFolder: string,
  move: (path: string) => string,
): { current: string; fromFolder: string } | null {
  const next = {
    current: current && move(current),
    fromFolder: fromFolder && move(fromFolder),
  };
  return next.current === current && next.fromFolder === fromFolder
    ? null
    : next;
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
