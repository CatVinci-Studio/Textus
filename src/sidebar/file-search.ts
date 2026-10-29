import type { IndexedFile } from "../platform/ipc";
import { mayBePinyin, pinyinIndexOf, readings } from "../utils/pinyin";
import { searchFold } from "../utils/search-fold";

/** Most results the sidebar draws: past this the list is a wall, and the
 *  answer is a longer query. */
export const MAX_SHOWN_MATCHES = 200;

/** The search box's filter beside it: every file, or documents only. */
export type SearchScope = "all" | "documents";

/** What Textus opens as a document, listed before every other file. */
const DOCUMENT_EXTENSIONS = new Set(["md", "markdown", "txt", "text"]);

export function isDocumentName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && DOCUMENT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** An indexed file with what its name is compared as, worked out once per
 *  index rather than on every keystroke. */
export interface SearchEntry extends IndexedFile {
  name: string;
  /** The folder it is in, from the indexed one ("" at the top). */
  folder: string;
  isDocument: boolean;
  key: string;
  /** A Chinese name's readings, for a query typed in pinyin. */
  pinyin: string[][] | null;
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
        isDocument: isDocumentName(name),
        key: searchFold(name),
        pinyin: readings(name),
      };
    })
    .sort(
      (a, b) =>
        collator.compare(a.name, b.name) ||
        collator.compare(a.folder, b.folder),
    );
}

/**
 * The files whose name contains `query`, ignoring case and accents, or spells it in
 * pinyin: documents first, then names starting with the query, each group
 * in index order. At most `limit`; an empty query matches nothing.
 */
export function matchFiles(
  entries: SearchEntry[],
  query: string,
  scope: SearchScope = "all",
  limit = MAX_SHOWN_MATCHES,
): SearchEntry[] {
  const needle = searchFold(query.trim());
  if (!needle) return [];
  const pinyin = mayBePinyin(needle);
  // [document starts, document contains, other starts, other contains]
  const groups: SearchEntry[][] = [[], [], [], []];
  for (const entry of entries) {
    if (scope === "documents" && !entry.isDocument) continue;
    let at = entry.key.indexOf(needle);
    if (at < 0 && pinyin && entry.pinyin)
      at = pinyinIndexOf(entry.pinyin, needle);
    if (at < 0) continue;
    const group = groups[(entry.isDocument ? 0 : 2) + (at === 0 ? 0 : 1)];
    if (group.length < limit) group.push(entry);
    // Enough documents starting with it: nothing below can rank higher.
    if (groups[0].length >= limit) break;
  }
  return groups.flat().slice(0, limit);
}
