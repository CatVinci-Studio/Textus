import { imageMimeForPath } from "../editor/images/pasted-files";
import {
  addCompletionSource,
  type PanelItem,
} from "../editor/extension-points";
import type { IndexedFile } from "../platform/ipc";
import { isNoteFile, isWithin, linkPath, relativePath } from "../utils/path";
import { folderIndex } from "./folder-index";
import { linkFolderIn, relativeTo } from "./link-resolve";
import { windowFolder } from "../platform/window-folder";

/**
 * A link's or a picture's target as it is typed - `[text](` and `![alt](` -
 * lists the folder's files by their path from the document. A picture lists
 * only images: a target there is nearly always one, and the list is shorter.
 * A link lists every file, notes first. An unsaved document, or one outside
 * the folder, has no path to start from and gets none.
 */

/** What a target can be completed as, and which files it lists. */
export type TargetKind = "image" | "link";

/** The "(" goes into what is replaced, so the list opens as it is typed;
 *  a space or angle bracket ends it, as a bare destination ends there. */
const PATTERNS: Record<TargetKind, RegExp> = {
  image: /!\[[^[\]\n]*\](\(([^()\s<>]*))$/,
  link: /(?<!!)\[[^[\]\n]*\](\(([^()\s<>]*))$/,
};

const KEEP: Record<TargetKind, (rel: string) => boolean> = {
  image: (rel) => imageMimeForPath(rel) !== null,
  link: () => true,
};

/** How a picked path ends: over the ")" the bracket pairing put in, adding
 *  one where nothing follows, or as it is inside an existing target. */
type Closing = "over" | "add" | "none";

function closingFor(after: string): Closing {
  if (after.startsWith(")")) return "over";
  return after === "" || /^\s/.test(after) ? "add" : "none";
}

/** The files `kind` lists, as targets from the document `doc` in the
 *  folder `root`: each path percent-escaped as Textus writes link paths, so
 *  a typed `![](…)` still reads as a picture. */
export function targetItems(
  files: readonly IndexedFile[],
  root: string,
  doc: string,
  kind: TargetKind,
): PanelItem[] {
  const from = linkFolderIn(root, doc);
  const self = relativeTo(root, doc);
  const kept = files.filter((f) => f.rel !== self && KEEP[kind](f.rel));
  // Notes first; otherwise the index's order.
  const ordered =
    kind === "link"
      ? [
          ...kept.filter((f) => isNoteFile(f.rel)),
          ...kept.filter((f) => !isNoteFile(f.rel)),
        ]
      : kept;
  return ordered.map((f) => {
    const path = relativePath(from, f.rel);
    const dest = linkPath(path);
    // Found as typed with "./" too, and escaped.
    const also = [
      ...(path.startsWith("../") ? [] : [`./${path}`]),
      ...(dest !== path ? [dest] : []),
    ];
    return {
      label: path,
      insert: `(${dest}`,
      icon: "file",
      ...(also.length ? { keywords: also.join(" ") } : {}),
    };
  });
}

/** `items` ending as `closing` says. */
function closed(items: PanelItem[], closing: Closing): PanelItem[] {
  if (closing === "none") return items;
  return items.map((item) => ({
    ...item,
    insert: `${item.insert})`,
    ...(closing === "over" ? { replaceAfter: 1 } : {}),
  }));
}

/** The lists last built, kept while the index they came from is. */
let built: {
  index: unknown;
  key: string;
  lists: Map<Closing, PanelItem[]>;
} | null = null;

export function registerPathCompletion(
  titles: Record<TargetKind, () => string>,
): () => void {
  const removers = (Object.keys(PATTERNS) as TargetKind[]).map((kind) =>
    addCompletionSource({
      id: `textus.paths.${kind}`,
      owner: "core",
      where: "text",
      inSource: true,
      pattern: PATTERNS[kind],
      replaceGroup: 1,
      title: titles[kind],
      provide: ({ path, after }) => {
        const folder = windowFolder();
        if (!folder || !path || !isWithin(path, folder)) return null;
        const closing = closingFor(after);
        return folderIndex(folder).then(
          (index) => {
            const key = `${folder}\n${path}\n${kind}`;
            if (built?.index !== index || built.key !== key)
              built = {
                index,
                key,
                lists: new Map([
                  ["none", targetItems(index.files, folder, path, kind)],
                ]),
              };
            const { lists } = built;
            let items = lists.get(closing);
            if (!items)
              lists.set(closing, (items = closed(lists.get("none")!, closing)));
            return { items, complete: true as const };
          },
          () => null,
        );
      },
    }),
  );
  return () => removers.forEach((remove) => remove());
}
