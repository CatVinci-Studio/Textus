import type { IndexedFile } from "../platform/ipc";

/** Most results the sidebar draws: past this the list is a wall, and the
 *  answer is a longer query. */
export const MAX_SHOWN_MATCHES = 200;

/** An indexed file with what its name is compared as, worked out once per
 *  index rather than on every keystroke. */
export interface SearchEntry extends IndexedFile {
  name: string;
  /** The folder it is in, from the indexed one ("" at the top). */
  folder: string;
  key: string;
}

/** Case and Unicode form folded away: macOS hands names over decomposed
 *  (é as e + ́), a typed query arrives composed. CJK has no case and is
 *  left as it is. */
function fold(text: string): string {
  return text.normalize("NFC").toLowerCase();
}

export function searchEntries(files: IndexedFile[]): SearchEntry[] {
  return files.map((file) => {
    const slash = file.rel.lastIndexOf("/");
    const name = slash >= 0 ? file.rel.slice(slash + 1) : file.rel;
    return {
      ...file,
      name,
      folder: slash >= 0 ? file.rel.slice(0, slash) : "",
      key: fold(name),
    };
  });
}

/**
 * The files whose name contains `query`, ignoring case: names that start
 * with it first, then the rest, each in index order (by folder, then
 * name). At most `limit`; an empty query matches nothing.
 */
export function matchFiles(
  entries: SearchEntry[],
  query: string,
  limit = MAX_SHOWN_MATCHES,
): SearchEntry[] {
  const needle = fold(query.trim());
  if (!needle) return [];
  const starts: SearchEntry[] = [];
  const contains: SearchEntry[] = [];
  for (const entry of entries) {
    const at = entry.key.indexOf(needle);
    if (at === 0) {
      starts.push(entry);
      if (starts.length >= limit) break;
    } else if (at > 0 && contains.length < limit) {
      contains.push(entry);
    }
  }
  return [...starts, ...contains].slice(0, limit);
}
