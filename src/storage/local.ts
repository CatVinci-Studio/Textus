/**
 * The webview's own localStorage, for small choices every window shares and
 * nothing is lost without. Blocked or full storage is caught here: a value
 * that can't be kept is just not remembered.
 */

/** Every localStorage key the app reads or writes outside the stores'
 *  fallbacks. Renaming one loses what users have saved under it. */
export const LOCAL_KEYS = {
  /** The settings blob from before settings.json: the settings store without
   *  Rust, and what the one-time import reads. */
  settings: "catvinci-settings",
  /** Deep thinking left on in the composer. */
  deepThinking: "textus-agent-deep-thinking",
  /** The Agent mode last picked, with the default it was picked under. */
  lastMode: "textus-agent-last-mode",
  /** A provider's last fetched model list, by provider id. */
  fetchedModels: (provider: string) => `textus-fetched-models:${provider}`,
  /** Where each file was last being read. */
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

/** A localStorage value as JSON, or null when absent or unreadable. */
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
