import { dirname, isInside } from "../utils/path";

/** Whether `path` is folder `dir` itself or lies somewhere below it. */
export function isWithin(path: string, dir: string): boolean {
  return path === dir || isInside(path, dir);
}

/**
 * Where the sidebar's file tree is rooted after the document in front, or
 * the opened folder, changes - given where it is rooted now.
 *
 * - An opened folder (File > Open Folder…) holds the tree. It may have been
 *   entered into a subfolder; it goes back to the folder itself only when
 *   the new document is in the folder but outside that subfolder.
 * - Without one, the tree stays where it is while the document is inside
 *   it - opening a file in a subfolder used to re-root the tree there, and
 *   the folder the user was looking at went with its expanded folders. A
 *   document elsewhere roots it at that document's folder.
 * - An unsaved draft shows `fallback` where there is one (iOS: the app's
 *   Documents folder, where Save puts it) and otherwise leaves the tree as
 *   it is - in a new window, nothing to show.
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
 * The AI's project folder (Settings.agentWorkspaceRoot) once a folder is
 * opened in the sidebar, or null to leave it. The AI follows the opened
 * folder while it has no project folder of its own: none chosen (""), or
 * the one an earlier Open Folder set (`fromFolder`). A folder the user
 * chose for the AI is theirs and stays.
 */
export function agentRootOnOpen(
  current: string,
  fromFolder: string,
  opened: string,
): string | null {
  if (current === opened) return null;
  return current === "" || current === fromFolder ? opened : null;
}

/** The same on Close Folder: back to the default ("", the document's own
 *  folder) if the AI's folder is the one this folder put there, else null
 *  to leave it. */
export function agentRootOnClose(
  current: string,
  fromFolder: string,
  closed: string,
): string | null {
  return current !== "" && current === fromFolder && closed === fromFolder
    ? ""
    : null;
}
