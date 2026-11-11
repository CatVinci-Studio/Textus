import { SettingsIndexing } from "../indexing";
import { Fragment, useState, useSyncExternalStore } from "react";
import { pageComponent } from "../builtin-pages";
import {
  ChevronIcon,
  GoToIcon,
  PluginsTabIcon,
} from "../../engine/controls/icons";
import { PLUGINS_SHOWN } from "../../plugins/store/availability";
import { isDesktopApp } from "../../platform/capabilities";
import { SHOW_SIDEBAR_TAB_EVENT } from "../../utils/events";
import { useSettings } from "../../prefs/SettingsContext";
import { localeOf } from "../../i18n/strings";
import { useMarginAvailable } from "../../ai/margin/margin-room";
import { SearchField } from "../../engine/controls/SearchField";
import {
  SETTINGS_GROUPS,
  settingsPage,
  settingsPages,
} from "../settings-pages";
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
 * icon, Appearance's, Editing's and Textus AI's folded under their groups
 * until opened, the one the Settings tab shows marked; over
 * them, Settings' one search - its results stand in for the list, and a
 * result goes to its page and row in the tab.
 */
export function SettingsNavPanel() {
  const { settings, setSettings, t } = useSettings();
  const marginAvailable = useMarginAvailable();
  const shown = useSyncExternalStore(onSettingsPageShown, settingsPageShown);
  const search = useSettingsSearch(() => false);
  const pages = settingsPages();
  const groupOf = (id: string | null) => pages.find((p) => p.id === id)?.group;
  // A group opens as one of its pages is shown, and folds when told to,
  // that page's too.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    const group = groupOf(shown);
    return new Set(group ? [group] : []);
  });
  const [openedFor, setOpenedFor] = useState(shown);
  if (openedFor !== shown) {
    setOpenedFor(shown);
    const group = groupOf(shown);
    if (group) setOpen((was) => new Set(was).add(group));
  }
  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
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
  const searchPages: SearchablePage[] = pages.map((p) => {
    const Page = pageComponent(p);
    return {
      key: p.id,
      name: p.label(t),
      render: () => (
        <SettingsIndexing.Provider value>
          <Page {...indexProps} indexing />
        </SettingsIndexing.Provider>
      ),
    };
  });
  // Plugins' own settings are in their panel: the way there, before
  // Shortcuts.
  const pluginsItem = PLUGINS_SHOWN && isDesktopApp && (
    <button
      type="button"
      key="plugins"
      className="tx-list-item settings-nav-away"
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent(SHOW_SIDEBAR_TAB_EVENT, {
            detail: "plugins",
          }),
        )
      }
    >
      <PluginsTabIcon className="settings-nav-icon" />
      <span className="settings-nav-group-name">{t.extensionsTabPlugins}</span>
      <GoToIcon className="settings-nav-chevron" />
    </button>
  );
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
          {pages.map((p, i) => {
            const item = (
              <button
                key={p.id}
                type="button"
                className="tx-list-item"
                data-sub={p.group ? "" : undefined}
                aria-current={p.id === shown ? "page" : undefined}
                onClick={() => openSettingsPage(p.id)}
              >
                {p.Icon && <p.Icon className="settings-nav-icon" />}
                {p.label(t)}
              </button>
            );
            if (!p.group)
              return p.id === "shortcuts" ? [pluginsItem, item] : item;
            const first = pages[i - 1]?.group !== p.group;
            const isOpen = open.has(p.group);
            const group = SETTINGS_GROUPS[p.group];
            return (
              <Fragment key={p.id}>
                {first && (
                  <button
                    type="button"
                    className="tx-list-item"
                    aria-expanded={isOpen}
                    onClick={() => toggle(p.group!)}
                  >
                    <group.Icon className="settings-nav-icon" />
                    <span className="settings-nav-group-name">
                      {group.label(t)}
                    </span>
                    <ChevronIcon className="settings-nav-chevron" />
                  </button>
                )}
                {isOpen && item}
              </Fragment>
            );
          })}
        </nav>
      )}
    </div>
  );
}
