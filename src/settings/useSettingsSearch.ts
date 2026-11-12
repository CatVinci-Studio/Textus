import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { comboFromEvent } from "../utils/shortcuts";
import { useWindowEvent } from "../utils/hooks/useWindowEvent";
import { TOGGLE_FIND_REPLACE_EVENT } from "../utils/events";
import { matchEntries, type SearchEntry } from "./settings-search";

/** The search box: while it holds a query its results stand in for the page,
 *  and picking one goes to the row. */
export function useSettingsSearch(
  /** Whether ⌘F is Settings' now (its tab in use); always, as a sheet. */
  owns: () => boolean = () => true,
) {
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  const deferredQuery = useDeferredValue(query);
  const [entries, setEntries] = useState<SearchEntry[]>([]);
  const [active, setActive] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const listId = useId();
  const matches = useMemo(
    () => matchEntries(entries, deferredQuery),
    [entries, deferredQuery],
  );

  const focusSearch = useCallback(() => {
    searchInput.current?.focus();
    searchInput.current?.select();
  }, []);
  // Ctrl/⌘+F finds in Settings while it is open, not in the document behind
  // it; on a Mac the Edit › Find menu takes the keys first.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (comboFromEvent(e) !== "mod+f" || !owns()) return;
      // A shortcut being recorded takes the keys as they are.
      if (
        e.target instanceof Element &&
        e.target.closest(".shortcut-capture-active")
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      focusSearch();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [focusSearch, owns]);
  useWindowEvent(TOGGLE_FIND_REPLACE_EVENT, () => owns() && focusSearch());

  return {
    query,
    setQuery,
    searching,
    setEntries,
    active,
    setActive,
    matches,
    searchInput,
    listId,
  };
}
