import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type Ref,
} from "react";
import type { Strings } from "../i18n/strings";
import { announce } from "../ui/announce";
import { SearchIcon } from "../ui/icons";
import { scrollBehavior } from "../ui/motion";
import { useLatest } from "../utils/hooks/useLatest";
import {
  harvestPage,
  type SearchEntry,
  type SearchMatch,
} from "./settings-search";

// The search box at the top of Settings' categories and the results that
// stand in for the page while it holds a query (settings-search.ts finds
// them). The box is a combobox over the results: ↑/↓ move, Enter goes to
// the row, Esc clears.

/** A page the search reads, rendered out of sight while a query is typed. */
export interface SearchablePage {
  key: string;
  /** "Editor & Appearance" or "Editor & Appearance › More themes". */
  name: string;
  render: () => ReactNode;
}

/**
 * Every searchable page, mounted hidden (no layout, out of the
 * accessibility tree and the tab order) for as long as there is a query,
 * and read into entries as it renders - and again when a row arrives late,
 * such as a status fetched from the backend.
 */
export function SettingsSearchIndex({
  pages,
  onEntries,
}: {
  pages: SearchablePage[];
  onEntries: (entries: SearchEntry[]) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const latest = useLatest({ pages, onEntries });
  const keys = pages.map((p) => p.key).join("\n");

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      latest.current.onEntries(
        latest.current.pages.flatMap((page) => {
          const pageRoot = el.querySelector(
            `[data-search-page="${CSS.escape(page.key)}"]`,
          );
          return pageRoot ? harvestPage(pageRoot, page.key) : [];
        }),
      );
    };
    read();
    const observer = new MutationObserver(() => {
      frame ||= requestAnimationFrame(read);
    });
    observer.observe(el, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [keys, latest]);

  return (
    <div ref={root} hidden className="settings-search-index">
      {pages.map((page) => (
        <div key={page.key} data-search-page={page.key}>
          {page.render()}
        </div>
      ))}
    </div>
  );
}

export function SettingsSearchField({
  t,
  inputRef,
  query,
  listId,
  activeId,
  onQueryChange,
  onMove,
  onPick,
}: {
  t: Strings;
  inputRef: Ref<HTMLInputElement>;
  query: string;
  listId: string;
  /** The option ↑/↓ have reached, announced as the box's active one. */
  activeId: string | undefined;
  onQueryChange: (query: string) => void;
  onMove: (step: 1 | -1) => void;
  onPick: () => void;
}) {
  const searching = query.trim() !== "";
  return (
    <div className="settings-search" role="search">
      <SearchIcon className="settings-search-icon" />
      <input
        ref={inputRef}
        className="settings-search-input"
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={searching}
        aria-controls={searching ? listId : undefined}
        aria-activedescendant={searching ? activeId : undefined}
        aria-label={t.settingsSearchPlaceholder}
        placeholder={t.settingsSearchPlaceholder}
        // Its width comes from the column, not from a default size that
        // would widen the categories beside the page.
        size={1}
        spellCheck={false}
        autoComplete="off"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            onMove(e.key === "ArrowDown" ? 1 : -1);
          } else if (e.key === "Enter") {
            e.preventDefault();
            onPick();
          } else if (e.key === "Escape" && query) {
            // Handled: the dialog closes on the next Escape, not this one.
            e.preventDefault();
            onQueryChange("");
          }
        }}
      />
    </div>
  );
}

export interface SearchResultGroup {
  key: string;
  name: string;
  matches: SearchMatch[];
}

export function SettingsSearchResults({
  t,
  groups,
  listId,
  optionId,
  active,
  onPick,
}: {
  t: Strings;
  groups: SearchResultGroup[];
  listId: string;
  optionId: (index: number) => string;
  active: number;
  onPick: (match: SearchMatch) => void;
}) {
  const empty = groups.length === 0;
  useEffect(() => {
    if (empty) announce(t.settingsSearchNoMatches);
  }, [empty, t.settingsSearchNoMatches]);
  let index = 0;
  return (
    <>
      <h1 className="settings-category-title">{t.settingsSearchResults}</h1>
      {empty ? (
        <div className="settings-row-hint settings-search-empty">
          {t.settingsSearchNoMatches}
        </div>
      ) : (
        <div id={listId} role="listbox" aria-label={t.settingsSearchResults}>
          {groups.map((group) => (
            <section
              key={group.key}
              className="settings-group"
              role="group"
              aria-labelledby={`${listId}-${group.key}`}
            >
              <h2
                id={`${listId}-${group.key}`}
                className="settings-group-title"
              >
                {group.name}
              </h2>
              <div className="settings-group-body">
                {group.matches.map((match) => {
                  const i = index++;
                  const { entry } = match;
                  const context = match.byHelp ? entry.help : entry.group;
                  return (
                    <div
                      key={`${entry.kind}:${entry.group}:${entry.label}`}
                      id={optionId(i)}
                      role="option"
                      aria-selected={i === active}
                      className={`settings-row settings-search-result${i === active ? " is-active" : ""}`}
                      // Keeps the keyboard in the box, so ↑/↓ and Enter go
                      // on working after a click.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onPick(match)}
                    >
                      <div className="settings-row-text">
                        <div className="settings-row-label">{entry.label}</div>
                        {context && (
                          <div className="settings-row-hint settings-search-context">
                            {context}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

const FOCUSABLE =
  ":is(input, select, textarea, button, a[href]):not(.info-tip-button):not(:disabled)";

/** Takes the user to a found row on its page: unfolds what hides it,
 *  scrolls it to the middle, gives it the keyboard and tints it for a
 *  moment (motion.css's --dur-linger; reduced motion jumps instead of
 *  scrolling, the tint still fades). */
export function revealEntry(el: HTMLElement) {
  const details = el.closest("details");
  if (details && !details.open) details.open = true;
  el.scrollIntoView({ block: "center", behavior: scrollBehavior() });
  const target = el.matches(FOCUSABLE)
    ? el
    : el.querySelector<HTMLElement>(FOCUSABLE);
  if (target) target.focus({ preventScroll: true });
  else {
    el.tabIndex = -1;
    el.focus({ preventScroll: true });
  }
  el.classList.remove("settings-search-hit");
  void el.offsetWidth;
  el.classList.add("settings-search-hit");
  // Its own animation's end, not one bubbling up from a control inside.
  const done = (e: AnimationEvent) => {
    if (e.target !== el) return;
    el.classList.remove("settings-search-hit");
    el.removeEventListener("animationend", done);
  };
  el.addEventListener("animationend", done);
}
