import { fill } from "../i18n/fill";
import { plural } from "../i18n/plural";
import type { Lang, Strings } from "../i18n/strings";
import { basename, folderName } from "../utils/path";
import type { DraggedFile } from "../engine/controls/document-drop";

/** The tree's own rows, dragged out of the window and brought back: moved
 *  as a row dragged within the tree is, or with the copy key copied. */
export interface RowsBack {
  copy: boolean;
}

/** Files dragged over the window from a file manager, or the tree's own
 *  rows brought back, as the file tree takes them: the folder under the
 *  pointer lit, and let go there, copied in (or moved, `RowsBack`). Set by
 *  the tree; the window's drag events (useFileDrops) ask it before the
 *  documents. */
export interface TreeFileDrop {
  /** The pointer is at (x, y): lights the folder `files` would go into;
   *  false off the tree, or where it takes none. */
  over(
    files: readonly DraggedFile[],
    x: number,
    y: number,
    back?: RowsBack,
  ): boolean;
  /** The drag left the tree, or was given up. */
  leave(): void;
  /** `files` let go at (x, y): copied into the folder there (asked first,
   *  unless the user said not to), or the rows brought back moved or
   *  copied there; false off the tree, or where it takes none. */
  drop(
    files: readonly DraggedFile[],
    x: number,
    y: number,
    back?: RowsBack,
  ): boolean;
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
