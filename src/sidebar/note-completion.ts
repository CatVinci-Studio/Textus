import {
  addCompletionSource,
  type PanelItem,
} from "../editor/extension-points";
import { fs } from "../platform/ipc";
import type { IndexedFile } from "../platform/ipc";
import { isDocumentName } from "./file-search";

/**
 * `[[` lists the folder's notes - the core's fallback, gone as soon as a
 * plugin (Two-way Links) completes `[[` itself.
 */

/** An index older than this is read again on the next `[[`. */
const FRESH_MS = 10_000;

interface Notes {
  root: string;
  at: number;
  /** Without and with the "]]" already after the caret replaced. */
  lists: Promise<[PanelItem[], PanelItem[]]>;
}

let root: string | null = null;
let notes: Notes | null = null;

/** The window's folder, where `[[` looks. */
export function setNoteCompletionRoot(next: string | null): void {
  if (next !== root) notes = null;
  root = next;
}

const stem = (name: string) => name.replace(/\.(md|markdown)$/i, "");

/** Each note by the shortest name that finds it: its own where no other
 *  note shares it, else its path in the folder. */
export function noteItems(files: readonly IndexedFile[]): PanelItem[] {
  const docs = files.filter((f) => /\.(md|markdown)$/i.test(f.rel));
  const count = new Map<string, number>();
  const nameOf = (rel: string) => stem(rel.slice(rel.lastIndexOf("/") + 1));
  for (const f of docs) {
    const key = nameOf(f.rel).toLowerCase();
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  return docs.map((f) => {
    const name = nameOf(f.rel);
    const slash = f.rel.lastIndexOf("/");
    const target = count.get(name.toLowerCase())! > 1 ? stem(f.rel) : name;
    return {
      label: name,
      insert: `[[${target}]]`,
      icon: "file",
      ...(slash > 0 ? { detail: f.rel.slice(0, slash) } : {}),
    };
  });
}

function load(folder: string): Notes {
  const lists = fs.indexFolder(folder).then((index) => {
    const items = noteItems(
      index.files.filter((f) => isDocumentName(f.rel)),
    );
    return [items, items.map((i) => ({ ...i, replaceAfter: 2 }))] as [
      PanelItem[],
      PanelItem[],
    ];
  });
  return { root: folder, at: Date.now(), lists };
}

export function registerNoteCompletion(title: () => string): () => void {
  return addCompletionSource({
    id: "textus.notes",
    owner: "core",
    where: "text",
    fallback: true,
    pattern: /\[\[([^[\]|#^\n]*)$/,
    title,
    provide: ({ after }) => {
      if (!root) return null;
      if (!notes || notes.root !== root || Date.now() - notes.at > FRESH_MS)
        notes = load(root);
      const paired = after.startsWith("]]");
      return notes.lists.then(
        (lists) => ({ items: lists[paired ? 1 : 0], complete: true }),
        () => null,
      );
    },
  });
}
