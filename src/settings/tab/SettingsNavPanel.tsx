import { useSyncExternalStore } from "react";
import { useSettings } from "../../prefs/SettingsContext";
import { localeOf } from "../../i18n/strings";
import { useMarginAvailable } from "../../ai/margin/margin-room";
import { SearchField } from "../../engine/controls/SearchField";
import { settingsPage, settingsPages } from "../settings-pages";
import { SettingsSearchIndex, type SearchablePage } from "../SettingsSearch";
import { useSettingsSearch } from "../useSettingsSearch";
import {
  onSettingsPageShown,
  openSettingsPage,
  settingsPageShown,
} from "../settings-nav";
import type { SettingsPageProps } from "../pages/types";
import "./settings-nav.css";

/**
 * Settings' pages in the sidebar (the rail's gear): each page with its
 * icon, Textus AI's under it, the one the Settings tab shows marked; over
 * them, Settings' one search - its results stand in for the list, and a
 * result goes to its page and row in the tab.
 */
export function SettingsNavPanel() {
  const { settings, setSettings, t } = useSettings();
  const marginAvailable = useMarginAvailable();
  const shown = useSyncExternalStore(onSettingsPageShown, settingsPageShown);
  const search = useSettingsSearch(() => false);
  const pages = settingsPages();
  // The pages read for the search: rendered out of sight, never used.
  const indexProps: SettingsPageProps = {
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
    openPage: () => {},
    openHelp: () => {},
    onOpenFile: () => {},
    onClose: () => {},
    fixedShortcuts: [],
    pluginCommands: [],
  };
  const searchPages: SearchablePage[] = pages.map((p) => ({
    key: p.id,
    name: p.label(t),
    render: () => <p.Page {...indexProps} indexing />,
  }));
  return (
    <div className="settings-nav-panel">
      <div className="tx-pane-row">
        <SearchField
          ref={search.searchInput}
          value={search.query}
          placeholder={t.settingsSearchPlaceholder}
          aria-label={t.settingsSearchPlaceholder}
          onChange={(e) => search.setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") search.setQuery("");
          }}
        />
      </div>
      {search.searching ? (
        <div className="settings-nav-results" role="list">
          {search.matches.length === 0 && (
            <p className="tx-list-note">{t.settingsSearchNoMatches}</p>
          )}
          {search.matches.slice(0, 60).map((m, i) => (
            <button
              key={`${m.entry.page}-${m.entry.label}-${i}`}
              type="button"
              className="tx-list-item settings-nav-hit"
              onClick={() => {
                search.setQuery("");
                openSettingsPage(m.entry.page, m.entry);
              }}
            >
              <span className="settings-nav-hit-text">
                <span>{m.entry.label}</span>
                <span className="settings-nav-hit-where">
                  {settingsPage(m.entry.page)?.label(t)}
                  {m.entry.group ? ` › ${m.entry.group}` : ""}
                </span>
              </span>
            </button>
          ))}
          <SettingsSearchIndex
            pages={searchPages}
            onEntries={search.setEntries}
          />
        </div>
      ) : (
        <nav className="settings-nav-list" aria-label={t.settingsTitle}>
          {pages.map((p) => (
            <button
              key={p.id}
              type="button"
              className="tx-list-item"
              data-sub={p.parent ? "" : undefined}
              aria-current={p.id === shown ? "page" : undefined}
              onClick={() => openSettingsPage(p.id)}
            >
              {p.Icon && <p.Icon className="settings-nav-icon" />}
              {p.label(t)}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
