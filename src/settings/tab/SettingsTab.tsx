import { useEffect, useRef, useState } from "react";
import { useSettings } from "../../prefs/SettingsContext";
import { localeOf } from "../../i18n/strings";
import { useMarginAvailable } from "../../ai/margin/margin-room";
import { emitMenuEvent } from "../../platform/menu-events";
import { settingsPage, settingsPages } from "../settings-pages";
import {
  revealEntry,
  SettingsSearchField,
  SettingsSearchIndex,
  SettingsSearchResults,
  type SearchablePage,
} from "../SettingsSearch";
import { findEntryElement, type SearchMatch } from "../settings-search";
import { useSettingsSearch } from "../useSettingsSearch";
import { AboutPage } from "../pages/AboutPage";
import type { SettingsPageProps, ShortcutCommand } from "../pages/types";
import type { FixedShortcutGroup } from "../../app/fixed-shortcuts";
import "../SettingsPanel.css";
import "./settings-tab.css";

export interface SettingsTabProps {
  /** The page to show first; "updates" is About, checking at once. */
  page?: string;
  onOpenFile: (path: string) => void;
  onFilesDeleted?: (paths: string[]) => void;
  docPath?: string | null;
  fixedShortcuts?: FixedShortcutGroup[];
  pluginCommands?: ShortcutCommand[];
}

/**
 * Settings as a tab (desktop): its pages listed on the left - an icon
 * each, Textus AI's three under it - the search over them, and the page
 * on the right under its title and the line saying what it holds. While
 * the search holds a query, its results stand in for the page.
 */
export function SettingsTab({
  page: first = "general",
  onOpenFile,
  onFilesDeleted,
  docPath = null,
  fixedShortcuts = [],
  pluginCommands = [],
}: SettingsTabProps) {
  const { settings, setSettings, t } = useSettings();
  const marginAvailable = useMarginAvailable();
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(first === "updates" ? "about" : first);
  const [jump, setJump] = useState<SearchMatch["entry"] | null>(null);
  // ⌘F searches Settings only while it is the tab in use.
  const search = useSettingsSearch(
    () =>
      !!root.current?.offsetParent &&
      root.current.contains(document.activeElement),
  );
  useReveal(content, jump, () => setJump(null));

  const pages = settingsPages();
  const shown = settingsPage(page) ?? pages[0];
  const pageProps: SettingsPageProps = {
    t,
    settings,
    setSettings,
    phone: false,
    percent: new Intl.NumberFormat(localeOf(settings.language), {
      style: "percent",
    }),
    marginAvailable,
    noMargin: !marginAvailable,
    setSubpage: () => {},
    openPage: setPage,
    openHelp: (doc) => emitMenuEvent(`help-doc:${doc}`),
    onOpenFile,
    onFilesDeleted,
    docPath,
    onClose: () => {},
    fixedShortcuts,
    pluginCommands,
  };
  const searchPages: SearchablePage[] = pages.map((p) => ({
    key: p.id,
    name: p.parent
      ? `${settingsPage(p.parent)?.label(t)} › ${p.label(t)}`
      : p.label(t),
    render: () => <p.Page {...pageProps} indexing />,
  }));
  const groups = searchPages
    .map((p) => ({
      key: p.key,
      name: p.name,
      matches: search.matches.filter((m) => m.entry.page === p.key),
    }))
    .filter((g) => g.matches.length > 0);
  const flat = groups.flatMap((g) => g.matches);
  const active = Math.min(search.active, Math.max(flat.length - 1, 0));
  const optionId = (i: number) => `${search.listId}-option-${i}`;
  const pick = (match: SearchMatch | undefined) => {
    if (!match) return;
    search.setQuery("");
    setPage(match.entry.page);
    setJump(match.entry);
  };

  return (
    <div className="settings-tab" ref={root}>
      <nav className="settings-tab-nav" aria-label={t.settingsTitle}>
        <div className="pane-search">
          <SettingsSearchField
            t={t}
            inputRef={search.searchInput}
            query={search.query}
            listId={search.listId}
            activeId={flat.length ? optionId(active) : undefined}
            onQueryChange={(next) => {
              search.setQuery(next);
              search.setActive(0);
            }}
            onMove={(step) =>
              flat.length &&
              search.setActive((active + step + flat.length) % flat.length)
            }
            onPick={() => pick(flat[active])}
          />
        </div>
        {pages.map((p) => (
          <button
            key={p.id}
            type="button"
            className="settings-tab-nav-item"
            data-sub={p.parent ? "" : undefined}
            aria-current={
              !search.searching && p.id === shown.id ? "page" : undefined
            }
            onClick={() => {
              search.setQuery("");
              setPage(p.id);
            }}
          >
            {p.Icon && <p.Icon className="settings-tab-nav-icon" />}
            {p.label(t)}
          </button>
        ))}
      </nav>
      <div
        className="settings-tab-page settings-content"
        ref={content}
        key={search.searching ? "search" : shown.id}
      >
        {search.searching ? (
          <SettingsSearchResults
            t={t}
            groups={groups}
            listId={search.listId}
            optionId={optionId}
            active={active}
            onPick={pick}
          />
        ) : (
          <>
            <h1 className="settings-category-title">{shown.label(t)}</h1>
            {shown.lead && <p className="settings-tab-lead">{shown.lead(t)}</p>}
            {shown.id === "about" ? (
              <AboutPage {...pageProps} checkUpdates={first === "updates"} />
            ) : (
              <shown.Page {...pageProps} />
            )}
          </>
        )}
        {search.searching && (
          <SettingsSearchIndex
            pages={searchPages}
            onEntries={search.setEntries}
          />
        )}
      </div>
    </div>
  );
}

/** Once a picked result's page is up, goes to its row: one that waits on
 *  the backend (a status, a list) can come a few frames late. */
function useReveal(
  content: React.RefObject<HTMLDivElement | null>,
  jump: SearchMatch["entry"] | null,
  done: () => void,
) {
  useEffect(() => {
    if (!jump) return;
    let frame = 0;
    let tries = 0;
    const go = () => {
      const el = content.current && findEntryElement(content.current, jump);
      if (el) revealEntry(el);
      else if (++tries < 30) {
        frame = requestAnimationFrame(go);
        return;
      }
      done();
    };
    go();
    return () => cancelAnimationFrame(frame);
  }, [jump, content, done]);
}
