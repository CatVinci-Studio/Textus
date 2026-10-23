import { useEffect, useState } from "react";
import { storage } from "../../platform/ipc";

/** A place a search found in a saved conversation
 *  (settings/chat_history/search.rs). */
export interface HistoryHit {
  id: string;
  docPath: string | null;
  title: string;
  updatedAt: number;
  role: "user" | "assistant";
  snippet: string;
}

/** How long typing rests before the conversations are searched. */
const REST_MS = 200;

/**
 * The saved conversations with every word of `query` in what was said,
 * newest first - null while there is no query, or before its first answer.
 */
export function useHistorySearch(query: string): HistoryHit[] | null {
  const [hits, setHits] = useState<{ query: string; hits: HistoryHit[] }>();
  const wanted = query.trim();
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    const timer = setTimeout(() => {
      void storage
        .chatHistorySearch(wanted)
        .then((found) => {
          if (live) setHits({ query: wanted, hits: found as HistoryHit[] });
        })
        .catch(() => {
          if (live) setHits({ query: wanted, hits: [] });
        });
    }, REST_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [wanted]);
  if (!wanted) return null;
  return hits?.query === wanted ? hits.hits : null;
}
