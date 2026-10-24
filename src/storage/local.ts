/**
 * The webview's own localStorage, for the few things kept there rather than
 * in Rust's files (docs/dev/storage.md): small choices every window of the
 * app shares and nothing is lost without - the store's own fallback when no
 * Rust is behind the page aside. Every read and write goes through here,
 * where blocked or full storage (a private browser window, a quota) is
 * caught: a value that can't be kept is just not remembered.
 */

/** Every localStorage key the app reads or writes outside the stores'
 *  pre-0.9.7 fallbacks (ui-state.ts, persisted-list.ts). Renaming one loses
 *  what users have saved under it. */
export const LOCAL_KEYS = {
  /** The settings blob from before settings.json - still the settings
   *  store without Rust, and what the one-time import reads
   *  (settings/settings-store.ts). */
  settings: "catvinci-settings",
  /** Deep thinking left on in the composer (ai/chat/deep-thinking.ts). */
  deepThinking: "textus-agent-deep-thinking",
  /** The Agent mode last picked, with the default it was picked under
   *  (ai/chat/last-mode.ts). */
  lastMode: "textus-agent-last-mode",
  /** A provider's last fetched model list, by provider id
   *  (ai/model-info.ts). */
  fetchedModels: (provider: string) => `textus-fetched-models:${provider}`,
  /** Where each file was last being read (document-view/reading-place.ts). */
  readingPlaces: "textus-reading-places",
} as const;

/** The value under `key`, or null when it is absent or can't be read. */
export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** A localStorage value as JSON, or null when absent or unreadable - for
 *  the fallback stores and the one-time import. */
export function readLocalJson(key: string): unknown {
  const raw = readLocal(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Keeps `value` under `key`; does nothing when storage refuses it. */
export function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the value just isn't remembered.
  }
}

export function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage unavailable: nothing was kept to remove.
  }
}
