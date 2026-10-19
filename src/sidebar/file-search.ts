import type { IndexedFile } from "../platform/ipc";

/** Most results the sidebar draws: past this the list is a wall, and the
 *  answer is a longer query. */
export const MAX_SHOWN_MATCHES = 200;

/** The search box's filter beside it: every file, or documents only. */
export type SearchScope = "all" | "documents";

/** What Textus opens as a document - the types File > Open offers before
 *  "All files". They are listed before every other file. */
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
}

/** Case and Unicode form folded away: macOS hands names over decomposed
 *  (é as e + ́), a typed query arrives composed. CJK has no case and is
 *  left as it is. */
function fold(text: string): string {
  return text.normalize("NFC").toLowerCase();
}

/** The index, in the order results are listed: by name as `collator`
 *  sorts names (utils/name-order.ts), then by folder. */
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
        key: fold(name),
      };
    })
    .sort(
      (a, b) =>
        collator.compare(a.name, b.name) ||
        collator.compare(a.folder, b.folder),
    );
}

/**
 * The files whose name contains `query`, ignoring case. Documents come
 * before other files, and within each, names that start with the query
 * before the rest - each group in index order. At most `limit`; an empty
 * query matches nothing.
 */
export function matchFiles(
  entries: SearchEntry[],
  query: string,
  scope: SearchScope = "all",
  limit = MAX_SHOWN_MATCHES,
): SearchEntry[] {
  const needle = fold(query.trim());
  if (!needle) return [];
  // [document starts, document contains, other starts, other contains]
  const groups: SearchEntry[][] = [[], [], [], []];
  for (const entry of entries) {
    if (scope === "documents" && !entry.isDocument) continue;
    const at = entry.key.indexOf(needle);
    if (at < 0) continue;
    const group = groups[(entry.isDocument ? 0 : 2) + (at === 0 ? 0 : 1)];
    if (group.length < limit) group.push(entry);
    // Enough documents starting with it: nothing below can rank higher.
    if (groups[0].length >= limit) break;
  }
  return groups.flat().slice(0, limit);
}
