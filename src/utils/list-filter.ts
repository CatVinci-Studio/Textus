import { mayBePinyin, pinyinEngine, pinyinIndexOf, readings } from "./pinyin";
import { searchFold } from "./search-fold";

/**
 * Filtering a whole list as the user types - the / panel, the command
 * palette, the file search: each label's folded and pinyin keys are worked
 * out once, when the list arrives, so a keystroke only compares strings -
 * 10,000 notes well inside a frame.
 */

/** What a list filters on: its label, and words that find it too. */
export interface Filterable {
  label: string;
  keywords?: string;
}

export interface PreparedList<T extends Filterable = Filterable> {
  items: readonly T[];
  /** The folded label, per item. */
  labels: string[];
  /** The folded label and keywords, for a query of several words. */
  all: string[];
  /** A Chinese label's readings, for a query typed in pinyin. */
  pinyin: (string[][] | null)[];
  /** The first letters of every reading, to pass over most labels at once. */
  initials: string[];
}

export function prepareList<T extends Filterable>(
  items: readonly T[],
): PreparedList<T> {
  const labels: string[] = [];
  const all: string[] = [];
  for (const item of items) {
    const label = searchFold(item.label);
    labels.push(label);
    all.push(item.keywords ? `${label} ${searchFold(item.keywords)}` : label);
  }
  return { items, labels, all, pinyin: [], initials: [] };
}

/** Works out the pinyin keys, the slow part, until `deadline`
 *  (performance.now()); true once every item has them. Until then a label
 *  without them isn't found by pinyin. */
export function preparePinyin(list: PreparedList, deadline: number): boolean {
  const { items, pinyin, initials } = list;
  // Not before the readings' source is in: every label would read as none.
  if (!pinyinEngine.peek()) return false;
  while (pinyin.length < items.length) {
    const chars = readings(items[pinyin.length].label);
    pinyin.push(chars);
    initials.push(
      chars
        ? chars
            .flat()
            .map((r) => r[0])
            .join("")
        : "",
    );
    if ((pinyin.length & 63) === 0 && performance.now() > deadline)
      return pinyin.length === items.length;
  }
  return true;
}

/** Where a word may start: after a space or a separator in a name. */
const WORD_EDGE = /[\s\-_/.()[\]#:]/;

/** How well `label` takes `query`: lower is better, -1 for not at all. */
function score(
  list: PreparedList,
  i: number,
  query: string,
  words: string[],
  pinyin: boolean,
) {
  const label = list.labels[i];
  const at = label.indexOf(query);
  if (at === 0) return 0;
  if (at > 0) {
    // A word starting with it beats a match inside a word.
    for (let from = at; from >= 0; from = label.indexOf(query, from + 1))
      if (WORD_EDGE.test(label[from - 1])) return 1;
    return 2;
  }
  const haystack = list.all[i];
  let every = true;
  for (const word of words)
    if (!haystack.includes(word)) {
      every = false;
      break;
    }
  if (every) return 3;
  const chars = pinyin ? list.pinyin[i] : undefined;
  // No reading starts with its first letter: no need to spell it out.
  if (!chars || !list.initials[i].includes(query[0])) return -1;
  return pinyinIndexOf(chars, query) >= 0 ? 4 : -1;
}

const BUCKETS = 5;

/**
 * The best `limit` items for `query`: the label starting with it (shortest
 * first), then a
 * word of it starting with it, then containing it, then every word in the
 * label or keywords, then the label spelt in pinyin; the provider's order
 * within each. An empty query keeps the provider's order.
 */
export function rankList<T extends Filterable>(
  list: PreparedList<T>,
  query: string,
  limit: number,
): T[] {
  const needle = searchFold(query.trim());
  if (!needle) return list.items.slice(0, limit);
  const words = needle.split(/\s+/);
  const pinyin = mayBePinyin(needle);
  const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
  const count = list.items.length;
  for (let i = 0; i < count; i++) {
    const rank = score(list, i, needle, words, pinyin);
    if (rank < 0) continue;
    const bucket = buckets[rank];
    if (bucket.length < limit) bucket.push(i);
  }
  // Of the labels starting with it, the closest - "smile" before "smiley" -
  // first; the provider's order between those as long.
  buckets[0].sort((a, b) => list.labels[a].length - list.labels[b].length);
  const out: T[] = [];
  for (const bucket of buckets)
    for (const i of bucket) {
      if (out.length >= limit) return out;
      out.push(list.items[i]);
    }
  return out;
}
