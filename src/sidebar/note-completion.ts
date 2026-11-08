import { onMemoryIdle } from "../utils/memory-idle";
import { isNoteFile, noteStem } from "../utils/path";
import {
  addCompletionSource,
  type PanelItem,
} from "../editor/extension-points";
import { fs } from "../platform/ipc";
import type { IndexedFile } from "../platform/ipc";
import { linkToTarget, pathIndex, type LinkStyle } from "../links/link-resolve";
import { linkStyleAt } from "../links/link-style";

/**
 * `[[` lists the folder's notes - the core's fallback, gone as soon as a
 * plugin (Two-way Links) completes `[[` itself.
 */

/** An index older than this is read again on the next `[[`. */
const FRESH_MS = 10_000;

interface Notes {
  /** Root, the document and its link style: what the links depend on. */
  key: string;
  at: number;
  /** Without and with the "]]" already after the caret replaced. */
  lists: Promise<[PanelItem[], PanelItem[]]>;
}

let root: string | null = null;
let notes: Notes | null = null;
onMemoryIdle(() => (notes = null));

/** The window's folder, where `[[` looks. */
export function setNoteCompletionRoot(next: string | null): void {
  if (next !== root) notes = null;
  root = next;
}

/** Each note, linked from `from` (an unsaved document: the folder's top)
 *  as `metadata.linkTo` writes a wiki link there. */
export function noteItems(
  files: readonly IndexedFile[],
  folder: string,
  from: string,
  style: LinkStyle,
): PanelItem[] {
  const paths = pathIndex(
    folder,
    files.map((f) => f.path),
  );
  return files
    .filter((f) => isNoteFile(f.rel))
    .map((f) => {
      const slash = f.rel.lastIndexOf("/");
      return {
        label: noteStem(f.rel.slice(slash + 1)),
        insert: linkToTarget(paths, f.path, from, style),
        icon: "file",
        ...(slash > 0 ? { detail: f.rel.slice(0, slash) } : {}),
      };
    });
}

function load(folder: string, from: string, key: string): Notes {
  const lists = Promise.all([fs.indexFolder(folder), linkStyleAt(from)]).then(
    ([index, style]) => {
      const items = noteItems(index.files, folder, from, style);
      return [items, items.map((i) => ({ ...i, replaceAfter: 2 }))] as [
        PanelItem[],
        PanelItem[],
      ];
    },
  );
  return { key, at: Date.now(), lists };
}

export function registerNoteCompletion(title: () => string): () => void {
  return addCompletionSource({
    id: "textus.notes",
    owner: "core",
    where: "text",
    fallback: true,
    pattern: /\[\[([^[\]|#^\n]*)$/,
    title,
    provide: ({ after, path }) => {
      if (!root) return null;
      const from = path ?? `${root.replace(/[\\/]+$/, "")}/Untitled.md`;
      const key = `${root}\n${from}`;
      if (!notes || notes.key !== key || Date.now() - notes.at > FRESH_MS)
        notes = load(root, from, key);
      const paired = after.startsWith("]]");
      return notes.lists.then(
        (lists) => ({ items: lists[paired ? 1 : 0], complete: true }),
        () => null,
      );
    },
  });
}
