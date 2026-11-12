import { isError } from "../utils/error-text";
import { fill } from "../i18n/fill";
import { tabElement } from "../engine/layout/tab-element";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { fs } from "../platform/ipc";
import { useSettings } from "../prefs/SettingsContext";
import { SearchField } from "../engine/controls/SearchField";
import { PathText } from "../engine/controls/PathText";
import { fileIconFor } from "../engine/controls/file-icons";
import { localeOf } from "../i18n/langs";
import { nameCollator } from "../utils/name-order";
import { matchFiles, searchEntries, type SearchEntry } from "./file-search";
import { pinyinEngine } from "../utils/pinyin";
import type { Strings } from "../i18n/strings";
import { isImeKeydown } from "../utils/ime";
import { listMove } from "../engine/controls/list-keys";

/** An index older than this is built again the next time the box gains
 *  focus: files come and go while the box sits unused. */
const INDEX_FRESH_MS = 5_000;

type IndexState =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "ready"; entries: SearchEntry[]; truncated: boolean }
  | { kind: "tooBroad" }
  | { kind: "failed" };

/**
 * The folder's files, indexed on first focus, on a later focus once stale,
 * or when `refreshKey` moves. Old results stay until new ones arrive.
 */
function useFolderIndex(
  root: string,
  refreshKey: number,
  collator: Intl.Collator,
) {
  const [index, setIndex] = useState<IndexState>({ kind: "none" });
  const builtAt = useRef(0);
  const request = useRef(0);

  // Another folder, Refresh or sort order: the index no longer stands.
  useEffect(() => {
    builtAt.current = 0;
    request.current++;
    setIndex({ kind: "none" });
  }, [root, refreshKey, collator]);

  const ensure = useCallback(() => {
    if (Date.now() - builtAt.current < INDEX_FRESH_MS) return;
    builtAt.current = Date.now();
    const id = ++request.current;
    setIndex((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
    Promise.all([
      fs.indexFolder(root),
      pinyinEngine.load().catch(() => null),
    ]).then(
      ([result]) => {
        if (id !== request.current) return;
        setIndex({
          kind: "ready",
          entries: searchEntries(result.files, collator),
          truncated: result.truncated,
        });
      },
      (err: unknown) => {
        if (id !== request.current) return;
        builtAt.current = 0;
        setIndex({
          kind: isError(err, "tooBroad") ? "tooBroad" : "failed",
        });
      },
    );
  }, [root, collator]);

  return { index, ensure };
}

/** The editor in front, for Esc to hand the keyboard back to: source
 *  mode's (also split view's left pane) before the rendered one. */
function focusEditor() {
  const tab = tabElement();
  const editor = [".source-view .cm-content", ".ProseMirror"]
    .flatMap((selector) => [
      ...(tab?.querySelectorAll<HTMLElement>(selector) ?? []),
    ])
    .find((el) => el.getClientRects().length > 0 && el.isContentEditable);
  editor?.focus();
}

/** The files matching the query, a beat behind the keystroke
 *  so a large index can't hold up typing. */
function useFileMatches(
  index: ReturnType<typeof useFolderIndex>["index"],
  query: string,
) {
  const deferredQuery = useDeferredValue(query);
  return useMemo(
    () =>
      index.kind === "ready"
        ? matchFiles(index.entries, deferredQuery, "all")
        : [],
    [index, deferredQuery],
  );
}

export function FileSearch({
  root,
  refreshKey,
  query,
  onQueryChange,
  onOpen,
  focusRequest,
  onFocusHandled,
  children,
}: {
  root: string;
  refreshKey: number;
  query: string;
  onQueryChange: (query: string) => void;
  onOpen: (path: string) => void;
  /** Set by the search shortcut: take the keyboard once mounted. */
  focusRequest: boolean;
  onFocusHandled: () => void;
  /** More results, under the files' (the text found in them). */
  children?: ReactNode;
}) {
  const { t, settings } = useSettings();
  const collator = nameCollator(localeOf(settings.language));
  const input = useRef<HTMLInputElement>(null);
  const { index, ensure } = useFolderIndex(root, refreshKey, collator);
  const [selected, setSelected] = useState(0);

  // The folder changed while the box has the keyboard: no focus event is
  // coming, so index now.
  useEffect(() => {
    if (document.activeElement === input.current) ensure();
  }, [ensure, refreshKey]);

  useEffect(() => {
    if (!focusRequest) return;
    input.current?.focus();
    input.current?.select();
    onFocusHandled();
  }, [focusRequest, onFocusHandled]);

  const matches = useFileMatches(index, query);
  const active = Math.min(selected, Math.max(matches.length - 1, 0));
  const listId = useId();

  const open = (entry: SearchEntry | undefined) => {
    if (entry) onOpen(entry.path);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isImeKeydown(e)) return;
    const moved = listMove(e.key, active, matches.length, false);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (moved !== null) setSelected(moved);
    } else if (e.key === "Enter") {
      e.preventDefault();
      open(matches[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onQueryChange("");
      focusEditor();
    }
  };

  const searching = query.trim() !== "";

  return (
    <>
      <div className="tx-pane-row file-search-bar">
        <SearchField
          ref={input}
          value={query}
          placeholder={t.searchPlaceholder}
          aria-label={t.searchPlaceholder}
          // A combobox: the focus stays in the box while ↑/↓ move
          // through the results, which a screen reader follows here.
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={searching}
          aria-controls={searching ? listId : undefined}
          aria-activedescendant={
            searching && matches.length > 0 ? `${listId}-${active}` : undefined
          }
          onFocus={ensure}
          onChange={(e) => {
            onQueryChange(e.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {searching && <h3 className="tx-list-heading">{t.searchNamesHeading}</h3>}
      {searching && (
        <div
          id={listId}
          className="file-search-results"
          role="listbox"
          aria-label={t.searchNamesHeading}
        >
          {matches.map((entry, i) => {
            const Icon = fileIconFor(entry.name);
            return (
              <button
                key={entry.path}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                className={`tree-row file-search-row ${i === active ? "tree-row-active" : ""}`}
                title={entry.rel}
                // Keeps the keyboard in the box, so ↑/↓ and Enter go on
                // working after a click.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setSelected(i);
                  open(entry);
                }}
              >
                <Icon className="tree-icon" />
                <span className="file-search-text">
                  <span className="tree-label">{entry.name}</span>
                  {entry.folder && (
                    <span className="file-search-folder">
                      <PathText path={entry.folder} />
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          <SearchNote index={index} matched={matches.length > 0} t={t} />
        </div>
      )}
      {searching && children}
    </>
  );
}

function SearchNote({
  index,
  matched,
  t,
}: {
  index: IndexState;
  matched: boolean;
  t: Strings;
}) {
  const note =
    index.kind === "tooBroad"
      ? t.treeSearchTooBroad
      : index.kind === "failed"
        ? t.treeSearchFailed
        : index.kind !== "ready"
          ? t.treeSearchIndexing
          : !matched
            ? t.treeSearchNoMatches
            : null;
  return (
    <>
      {note && <div className="tx-list-note">{note}</div>}
      {index.kind === "ready" && index.truncated && (
        <div className="tx-list-note">
          {fill(t.treeSearchCapped, { n: String(index.entries.length) })}
        </div>
      )}
    </>
  );
}
