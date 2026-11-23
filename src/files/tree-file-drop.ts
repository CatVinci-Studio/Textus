import { fill } from "../i18n/fill";
import { plural } from "../i18n/plural";
import type { Lang, Strings } from "../i18n/strings";
import { basename, folderName } from "../utils/path";
import type { DraggedFile } from "../engine/controls/document-drop";

/** Files from a file manager dragged over the window, as the file tree
 *  takes them: the folder under the pointer lit, and let go there, copied
 *  in. Set by the tree while a folder is open; the window's drag events
 *  (useFileDrops) ask it before the documents. */
export interface TreeFileDrop {
  /** The pointer is at (x, y): lights the folder it would go into; false
   *  off the tree. */
  over(x: number, y: number): boolean;
  /** The drag left the tree, or was given up. */
  leave(): void;
  /** `files` let go at (x, y): copied into the folder there (asked first,
   *  unless the user said not to); false off the tree. */
  drop(files: readonly DraggedFile[], x: number, y: number): boolean;
}

let current: TreeFileDrop | null = null;

export function setTreeFileDrop(drop: TreeFileDrop | null): void {
  current = drop;
}

export function treeFileDrop(): TreeFileDrop | null {
  return current;
}

/** How many names the question lists before "and n more". */
const LISTED = 5;

/** The question asked before copying `paths` into `folder`: how many,
 *  where, and their names, a long list cut short. */
export function copyQuestion(
  paths: readonly string[],
  folder: string,
  t: Strings,
  lang: Lang,
): string {
  const ask = fill(plural(t.treeCopyAsk, paths.length, lang), {
    folder: folderName(folder),
  });
  const names = paths.slice(0, LISTED).map(basename);
  const rest = paths.length - names.length;
  if (rest > 0) names.push(plural(t.treeCopyMore, rest, lang));
  return `${ask}\n\n${names.join("\n")}`;
}
