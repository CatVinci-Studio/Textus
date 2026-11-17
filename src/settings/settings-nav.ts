import type { SearchEntry } from "./settings-search";
import { SHOW_SIDEBAR_TAB_EVENT, sendAppEvent } from "../utils/events";
import { tabInUse, windowTabs } from "../engine/layout/store";
import { createSubscribers } from "../utils/store";

/**
 * Settings on the desktop: its pages listed in the sidebar, the one picked
 * shown in the window's Settings tab (one tab, its page replaced). This is
 * what ties the two: the page the tab shows, for the list to mark; and a
 * request to show one, for the window to bring the tab to it.
 */
let shown = "general";
const subscribers = createSubscribers();

export function settingsPageShown(): string {
  return shown;
}

export function setSettingsPageShown(id: string): void {
  if (id === shown) return;
  shown = id;
  subscribers.publish();
}

/** Whether the sidebar shows the list now (its panel mounted). */
let listShown = false;

export function settingsListShown(): boolean {
  return listShown;
}

export function setSettingsListShown(on: boolean): void {
  if (on === listShown) return;
  listShown = on;
  subscribers.publish();
}

/** The sidebar, open on Settings' pages. */
export function showSettingsList(): void {
  sendAppEvent(SHOW_SIDEBAR_TAB_EVENT, "settings");
}

export const onSettingsPageShown = subscribers.subscribe;

/** Asks the window to show Settings at `page`, at a search result's row. */
export const OPEN_SETTINGS_PAGE_EVENT = "textus:open-settings-page";

export interface SettingsPageRequest {
  page: string;
  jump?: SearchEntry;
}

export function openSettingsPage(page: string, jump?: SearchEntry): void {
  window.dispatchEvent(
    new CustomEvent<SettingsPageRequest>(OPEN_SETTINGS_PAGE_EVENT, {
      detail: { page, jump },
    }),
  );
}

/** ⌘F is Settings' search while the Settings tab is the one in use. */
export function settingsInUse(): boolean {
  const tab = windowTabs<{
    id: string;
    view?: { kind: string; view: string } | null;
  }>().find((t) => t.id === tabInUse());
  return tab?.view?.kind === "page" && tab.view.view === "settings";
}
