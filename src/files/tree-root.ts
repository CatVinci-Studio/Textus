import { dirname, isInside } from "../utils/path";

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
