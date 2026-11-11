import { TEXT_DOCUMENT_EXTENSIONS } from "../platform/bindings/files";
import type { IndexedFile } from "../platform/ipc";
import {
  preparePinyin,
  prepareList,
  rankList,
  type PreparedList,
} from "../utils/list-filter";

/** Most results the sidebar draws: past this the list is a wall, and the
 *  answer is a longer query. */
const MAX_SHOWN_MATCHES = 200;

/** The search box's filter beside it: every file, or documents only. */
export type SearchScope = "all" | "documents";

/** What Textus opens as a document, listed before every other file. */
const DOCUMENT_EXTENSIONS: ReadonlySet<string> = new Set(
  TEXT_DOCUMENT_EXTENSIONS,
);

export function isDocumentName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && DOCUMENT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** An indexed file with what its name is compared as, worked out once per
 *  index rather than on every keystroke. */
export interface SearchEntry extends IndexedFile {
  name: string;
  /** The name again, as the shared list filter reads it. */
  label: string;
  /** The folder it is in, from the indexed one ("" at the top). */
  folder: string;
  isDocument: boolean;
}

/** The index in result order: by name as `collator` sorts, then by folder. */
export function searchEntries(
  files: IndexedFile[],
  collator: Intl.Collator,
): SearchEntry[] {
  return files
    .map((file) => {
      const slash = file.rel.lastIndexOf("/");
      const name = slash >= 0 ? file.rel.slice(slash + 1) : file.rel;
      return {
        ...file,
        name,
        folder: slash >= 0 ? file.rel.slice(0, slash) : "",
        label: name,
        isDocument: isDocumentName(name),
      };
    })
    .sort(
      (a, b) =>
        collator.compare(a.name, b.name) ||
        collator.compare(a.folder, b.folder),
    );
}

const prepared = new WeakMap<SearchEntry[], PreparedList<SearchEntry>>();

/**
 * The files whose name `query` finds, by the filter the / panel uses (case,
 * accents and pinyin aside): documents first, each group best first. At
 * most `limit`; an empty query matches nothing.
 */
export function matchFiles(
  entries: SearchEntry[],
  query: string,
  scope: SearchScope = "all",
  limit = MAX_SHOWN_MATCHES,
): SearchEntry[] {
  if (!query.trim()) return [];
  let list = prepared.get(entries);
  if (!list) {
    list = prepareList(entries);
    prepared.set(entries, list);
  }
  preparePinyin(list, Infinity);
  const found = rankList(list, query, Infinity);
  const documents = found.filter((entry) => entry.isDocument);
  const others = scope === "all" ? found.filter((e) => !e.isDocument) : [];
  return [...documents, ...others].slice(0, limit);
}
