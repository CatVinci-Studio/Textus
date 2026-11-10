import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fs } from "../platform/ipc";
import { useSettings } from "../prefs/SettingsContext";
import { fileIconFor } from "../engine/controls/file-icons";
import { basename } from "../utils/path";
import { FileSearch } from "./FileSearch";
import "./FileTree.css";
import "./search-panel.css";

/** How long typing pauses before the documents are read for the text. */
const TEXT_DELAY_MS = 250;

interface TextHit {
  path: string;
  rel: string;
  line: number;
  text: string;
}

type TextState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; hits: TextHit[]; truncated: boolean }
  | { kind: "failed" };

/**
 * The sidebar's Search page, as VS Code's: one box over the folder the
 * tree shows - the files whose names match, then the documents' lines
 * holding the text (read by the backend's fd-style walk).
 */
export function SearchPanel({
  root,
  onOpen,
  focusRequest,
  onFocusHandled,
}: {
  root: string;
  onOpen: (path: string) => void;
  focusRequest: boolean;
  onFocusHandled: () => void;
}) {
  const [query, setQuery] = useState("");
  return (
    <div className="search-panel">
      <FileSearch
        root={root}
        refreshKey={0}
        query={query}
        onQueryChange={setQuery}
        onOpen={onOpen}
        focusRequest={focusRequest}
        onFocusHandled={onFocusHandled}
      >
        <TextMatches root={root} query={query} onOpen={onOpen} />
      </FileSearch>
    </div>
  );
}

function useTextSearch(root: string, query: string): TextState {
  const [state, setState] = useState<TextState>({ kind: "idle" });
  useEffect(() => {
    const needle = query.trim();
    if (!needle) {
      setState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setState((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
    const timer = setTimeout(() => {
      fs.searchFolderText(root, needle).then(
        (result) => !cancelled && setState({ kind: "ready", ...result }),
        () => !cancelled && setState({ kind: "failed" }),
      );
    }, TEXT_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [root, query]);
  return state;
}

/** `text` with each case-blind occurrence of `needle` marked. */
function marked(text: string, needle: string) {
  const lower = text.toLowerCase();
  const find = needle.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(find); at >= 0; at = lower.indexOf(find, from)) {
    parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="tx-hit">
        {text.slice(at, at + find.length)}
      </mark>,
    );
    from = at + find.length;
  }
  parts.push(text.slice(from));
  return parts;
}

function TextMatches({
  root,
  query,
  onOpen,
}: {
  root: string;
  query: string;
  onOpen: (path: string) => void;
}) {
  const { t } = useSettings();
  const state = useTextSearch(root, query);
  // One group per document, in the walk's order.
  const groups = useMemo(() => {
    const byPath = new Map<string, TextHit[]>();
    if (state.kind === "ready")
      for (const hit of state.hits)
        byPath.set(hit.path, [...(byPath.get(hit.path) ?? []), hit]);
    return [...byPath.values()];
  }, [state]);
  const needle = query.trim();
  const note =
    state.kind === "failed"
      ? t.treeSearchFailed
      : state.kind !== "ready"
        ? t.treeSearchIndexing
        : groups.length === 0
          ? t.searchTextNone
          : null;
  return (
    <section className="search-text" aria-label={t.searchTextHeading}>
      <h3 className="tx-list-heading">{t.searchTextHeading}</h3>
      {groups.map((hits) => {
        const Icon = fileIconFor(hits[0].path);
        return (
          <div key={hits[0].path} className="search-text-file">
            <button
              type="button"
              className="tree-row search-text-name"
              title={hits[0].rel}
              onClick={() => onOpen(hits[0].path)}
            >
              <Icon className="tree-icon" />
              <span className="tree-label">{basename(hits[0].path)}</span>
              <span className="found-count">{hits.length}</span>
            </button>
            {hits.map((hit) => (
              <button
                key={hit.line}
                type="button"
                className="tree-row search-text-line"
                onClick={() => onOpen(hit.path)}
              >
                <span className="search-text-snippet">
                  {marked(hit.text, needle)}
                </span>
              </button>
            ))}
          </div>
        );
      })}
      {note && <div className="tx-list-note">{note}</div>}
      {state.kind === "ready" && state.truncated && (
        <div className="tx-list-note">{t.searchTextCapped}</div>
      )}
    </section>
  );
}
