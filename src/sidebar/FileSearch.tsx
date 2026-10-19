import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fs } from "../platform/ipc";
import { useSettings } from "../settings/SettingsContext";
import { SearchIcon, fileIconFor } from "../ui/icons";
import { matchFiles, searchEntries, type SearchEntry } from "./file-search";
import type { Strings } from "../i18n/strings";

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
 * The folder's documents, indexed by the backend (commands/folder.rs) the
 * first time the box gains focus and again on a later focus once stale, or
 * after `refreshKey` moves (the tree's Refresh). A rebuild keeps the old
 * results on screen until the new ones arrive.
 */
function useFolderIndex(root: string, refreshKey: number) {
  const [index, setIndex] = useState<IndexState>({ kind: "none" });
  const builtAt = useRef(0);
  const request = useRef(0);

  // Another folder, or Refresh: what was indexed no longer stands.
  useEffect(() => {
    builtAt.current = 0;
    request.current++;
    setIndex({ kind: "none" });
  }, [root, refreshKey]);

  const ensure = useCallback(() => {
    if (Date.now() - builtAt.current < INDEX_FRESH_MS) return;
    builtAt.current = Date.now();
    const id = ++request.current;
    setIndex((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
    fs.indexFolder(root).then(
      (result) => {
        if (id !== request.current) return;
        setIndex({
          kind: "ready",
          entries: searchEntries(result.files),
          truncated: result.truncated,
        });
      },
      (err: unknown) => {
        if (id !== request.current) return;
        builtAt.current = 0;
        setIndex({
          kind: String(err).includes("TOO_BROAD") ? "tooBroad" : "failed",
        });
      },
    );
  }, [root]);

  return { index, ensure };
}

/** The editor in front, for Esc to hand the keyboard back to. */
function focusEditor() {
  document
    .querySelector<HTMLElement>(
      '[data-active-tab="true"] :is(.ProseMirror, textarea)',
    )
    ?.focus();
}

/**
 * The search box at the top of the Files tab: file names anywhere under
 * the folder, matched as you type. While it holds a query its results
 * stand in for the tree (which stays mounted underneath, expanded as it
 * was). Enter opens the selected match, ↑/↓ move, Esc clears and goes back
 * to the editor.
 */
export function FileSearch({
  root,
  refreshKey,
  query,
  onQueryChange,
  onOpen,
  focusRequest,
  onFocusHandled,
}: {
  root: string;
  refreshKey: number;
  query: string;
  onQueryChange: (query: string) => void;
  onOpen: (path: string) => void;
  /** Set by the search shortcut: take the keyboard once mounted. */
  focusRequest: boolean;
  onFocusHandled: () => void;
}) {
  const { t } = useSettings();
  const input = useRef<HTMLInputElement>(null);
  const { index, ensure } = useFolderIndex(root, refreshKey);
  const [selected, setSelected] = useState(0);

  // The folder changed (or Refresh) while the box has the keyboard: there
  // is no focus event to come, so index the new one now.
  useEffect(() => {
    if (document.activeElement === input.current) ensure();
  }, [ensure, refreshKey]);

  useEffect(() => {
    if (!focusRequest) return;
    input.current?.focus();
    input.current?.select();
    onFocusHandled();
  }, [focusRequest, onFocusHandled]);

  // Matching runs a beat behind the keystroke: the box shows each letter
  // at once, and a large index can't hold up typing.
  const deferredQuery = useDeferredValue(query);
  const matches = useMemo(
    () =>
      index.kind === "ready" ? matchFiles(index.entries, deferredQuery) : [],
    [index, deferredQuery],
  );
  const active = Math.min(selected, Math.max(matches.length - 1, 0));

  const open = (entry: SearchEntry | undefined) => {
    if (entry) onOpen(entry.path);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (matches.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setSelected((active + step + matches.length) % matches.length);
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
      <div className="file-search-field">
        <SearchIcon className="file-search-icon" />
        <input
          ref={input}
          className="file-search-input"
          type="search"
          value={query}
          placeholder={t.treeSearchPlaceholder}
          aria-label={t.treeSearchPlaceholder}
          aria-controls="file-search-results"
          spellCheck={false}
          autoComplete="off"
          onFocus={ensure}
          onChange={(e) => {
            onQueryChange(e.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {searching && (
        <div
          id="file-search-results"
          className="file-search-results"
          role="listbox"
          aria-label={t.treeSearchPlaceholder}
        >
          {matches.map((entry, i) => {
            const Icon = fileIconFor(entry.name);
            return (
              <button
                key={entry.path}
                role="option"
                aria-selected={i === active}
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
                      <bdi>{entry.folder}</bdi>
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          <SearchNote index={index} matched={matches.length > 0} t={t} />
        </div>
      )}
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
      {note && <div className="file-search-note">{note}</div>}
      {index.kind === "ready" && index.truncated && (
        <div className="file-search-note">
          {t.treeSearchCapped.replace("{n}", String(index.entries.length))}
        </div>
      )}
    </>
  );
}
