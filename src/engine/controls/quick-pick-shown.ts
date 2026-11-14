import { useEffect, useMemo, useState } from "react";
import {
  preparePinyin,
  prepareList,
  rankList,
  type Filterable,
  type PreparedList,
} from "../../utils/list-filter";
import type { QuickPickItem, Request } from "./quick-pick-queue";

type Entry = Filterable & { item: QuickPickItem };
const prepared = new WeakMap<readonly QuickPickItem[], PreparedList<Entry>>();

/** The items `query` finds, best first, by the filter the / panel uses:
 *  the label, then every word in the label or description, or a Chinese
 *  label spelled in pinyin. */
export function quickPickFilter(
  items: readonly QuickPickItem[],
  query: string,
): QuickPickItem[] {
  let list = prepared.get(items);
  if (!list) {
    list = prepareList(
      items.map((item) => ({
        label: item.label,
        keywords: item.description,
        item,
      })),
    );
    prepared.set(items, list);
  }
  preparePinyin(list, Infinity);
  return rankList(list, query, Infinity).map((entry) => entry.item);
}

/** How long typing rests before a list that searches is asked. */
const SEARCH_MS = 150;

/** The rows `query` shows: the request's items filtered here, or, for one
 *  that searches (a plugin's citations), what it answers for the query,
 *  as it answers - its items until then. */
export function useShownItems(
  request: Request,
  query: string,
): QuickPickItem[] {
  const [found, setFound] = useState<QuickPickItem[] | null>(null);
  const filtered = useMemo(() => {
    if (request.search) return request.items;
    // ":sa" finds Save as well as ":saveas"; ":12" is a line, not Heading
    // 1 or 2.
    const rest = query.startsWith(request.query)
      ? query.slice(request.query.length)
      : query;
    const words = /\p{L}/u.test(rest);
    const hits = quickPickFilter(request.items, query);
    return words
      ? [...new Set([...hits, ...quickPickFilter(request.items, rest)])]
      : hits;
  }, [request.items, request.query, request.search, query]);
  useEffect(() => {
    const search = request.search;
    if (!search) return;
    let live = true;
    const timer = setTimeout(() => {
      search(query)
        .then((items) => live && setFound(items))
        .catch(() => {});
    }, SEARCH_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [request.search, query]);
  return request.search ? (found ?? request.items) : filtered;
}
