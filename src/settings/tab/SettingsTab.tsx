import { useEffect, useRef, useSyncExternalStore } from "react";
import { ChevronIcon } from "../../engine/controls/icons";
import { pageComponent } from "../builtin-pages";
import { useSettings } from "../../prefs/SettingsContext";
import { localeOf } from "../../i18n/strings";
import { useMarginAvailable } from "../../ai/margin/margin-room";
import { emitMenuEvent } from "../../platform/menu-events";
import { settingsPage, settingsPages } from "../settings-pages";
import { revealEntry } from "../SettingsSearch";
import { findEntryElement, type SearchEntry } from "../settings-search";
import {
  OPEN_SETTINGS_PAGE_EVENT,
  onSettingsPageShown,
  setSettingsPageShown,
  settingsListShown,
  showSettingsList,
} from "../settings-nav";
import { AboutPage } from "../pages/AboutPage";
import type { SettingsPageProps, ShortcutCommand } from "../pages/types";
import type { FixedShortcutGroup } from "../../app/fixed-shortcuts";
import "../SettingsPanel.css";
import "./settings-tab.css";

export interface SettingsTabProps {
  /** The page to show; "updates" is About, checking at once. */
  page?: string;
  /** A search result's row to go to on it. */
  jump?: SearchEntry;
  onOpenFile: (path: string) => void;
  onFilesDeleted?: (paths: string[]) => void;
  docPath?: string | null;
  fixedShortcuts?: FixedShortcutGroup[];
  pluginCommands?: ShortcutCommand[];
}

/**
 * Settings as a tab (desktop): one page, the one picked in the sidebar's
 * list of them (SettingsNavPanel) - replaced, not opened beside. The list
 * says which it is, so the page doesn't: only its sections.
 */
export function SettingsTab({
  page = "general",
  jump,
  onOpenFile,
  onFilesDeleted,
  docPath = null,
  fixedShortcuts = [],
  pluginCommands = [],
}: SettingsTabProps) {
  const { settings, setSettings, t } = useSettings();
  const marginAvailable = useMarginAvailable();
  const content = useRef<HTMLDivElement>(null);
  const id = page === "updates" ? "about" : page;
  const shown = settingsPage(id) ?? settingsPages()[0];
  const Page = pageComponent(shown);
  useEffect(() => setSettingsPageShown(shown.id), [shown.id]);
  const listShown = useSyncExternalStore(
    onSettingsPageShown,
    settingsListShown,
  );
  useReveal(content, jump ?? null);
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
    openPage: (to) =>
      window.dispatchEvent(
        new CustomEvent(OPEN_SETTINGS_PAGE_EVENT, { detail: { page: to } }),
      ),
    openHelp: (doc) => emitMenuEvent(`help-doc:${doc}`),
    onOpenFile,
    onFilesDeleted,
    docPath,
    onClose: () => {},
    fixedShortcuts,
    pluginCommands,
  };
  return (
    <div className="settings-tab" ref={content}>
      {/* Too narrow a column to set anything in: shown instead of the page
          (settings-tab.css). */}
      <p className="tx-empty settings-tab-narrow">{t.settingsNeedsRoom}</p>
      <div className="settings-tab-page settings-content">
        {/* The list of pages is the sidebar's: with it put away, the way
            back to it. */}
        {!listShown && (
          <button
            type="button"
            className="text-button settings-back-button"
            onClick={showSettingsList}
          >
            <ChevronIcon className="settings-back-chevron" />
            {t.settingsTitle}
          </button>
        )}
        {shown.id === "about" ? (
          <AboutPage {...pageProps} checkUpdates={page === "updates"} />
        ) : (
          <Page {...pageProps} />
        )}
      </div>
    </div>
  );
}

/** Once the page is up, goes to the search result's row: one that waits on
 *  the backend (a status, a list) can come a few frames late. */
function useReveal(
  content: React.RefObject<HTMLDivElement | null>,
  jump: SearchEntry | null,
) {
  useEffect(() => {
    if (!jump) return;
    let frame = 0;
    let tries = 0;
    const go = () => {
      const el = content.current && findEntryElement(content.current, jump);
      if (el) revealEntry(el);
      else if (++tries < 30) frame = requestAnimationFrame(go);
    };
    go();
    return () => cancelAnimationFrame(frame);
  }, [jump, content]);
}
