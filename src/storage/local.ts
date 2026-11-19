/**
 * The webview's own localStorage, for small choices every window shares and
 * nothing is lost without. Blocked or full storage is caught here: a value
 * that can't be kept is just not remembered.
 */

/** Every localStorage key the app reads or writes outside the stores'
 *  fallbacks. Renaming one loses what users have saved under it. */
export const LOCAL_KEYS = {
  /** The settings where there is no Rust behind the page: the browser dev
   *  shim, the web playground, the unit tests. */
  settings: "catvinci-settings",
  /** A provider's last fetched model list, by provider id. */
  fetchedModels: (provider: string) => `textus-fetched-models:${provider}`,
  /** By scope (a folder, a document): its live conversation, its open
   *  ones. */
  liveConversation: "textus-ai-live:",
  openConversations: "textus-ai-open:",
  /** By conversation: who answers in it ("" Textus AI). */
  conversationAgent: "textus-ai-agent:",
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
