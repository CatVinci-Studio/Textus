import type { SearchEntry } from "./settings-search";

/**
 * Settings on the desktop: its pages listed in the sidebar, the one picked
 * shown in the window's Settings tab (one tab, its page replaced). This is
 * what ties the two: the page the tab shows, for the list to mark; and a
 * request to show one, for the window to bring the tab to it.
 */
let shown = "general";
const listeners = new Set<() => void>();

export function settingsPageShown(): string {
  return shown;
}

export function setSettingsPageShown(id: string): void {
  if (id === shown) return;
  shown = id;
  for (const listener of listeners) listener();
}

export function onSettingsPageShown(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

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
