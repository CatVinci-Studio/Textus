import { searchFold } from "./search-fold";

/** Whether `text` holds every word of `query`, case and Latin accents
 *  aside: the extension lists' search. */
export function matchesWords(text: string, query: string): boolean {
  const folded = searchFold(text);
  return searchFold(query)
    .split(/\s+/)
    .every((word) => folded.includes(word));
}
