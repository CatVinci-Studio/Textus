/**
 * The window's tabs in order, kept past the app's end (Android ending it in
 * the background, where nothing else of the window survives): each by a
 * key - a page by what it is (the AI's), a saved document by its path, a
 * tab with unsaved text by its id, its draft's.
 */

import {
  knownDocumentsDir,
  ownFolderMoved,
  storedDocumentPath,
} from "../platform/documents-path";

const KEY = "textus-tab-order";

export interface TabOrder {
  keys: string[];
  /** The key of the tab in front. */
  active: string;
}

interface Keyed {
  id?: string;
  path: string | null;
  view?: { kind: string; view?: string };
  text?: unknown;
}

function orderKey(tab: Keyed): string {
  if (tab.view) return `view:${tab.view.view ?? tab.view.kind}`;
  // Kept by its place in Documents: a reinstall moves an iOS app's folder.
  if (tab.path && !tab.text)
    return `path:${storedDocumentPath(tab.path, knownDocumentsDir())}`;
  return `id:${tab.id ?? ""}`;
}

/** A key's document resolved into this install's Documents `docs`. */
const resolved = (key: string, docs: string | null) =>
  docs && key.startsWith("path:")
    ? `path:${ownFolderMoved(key.slice(5), docs)}`
    : key;

export function writeTabOrder(tabs: readonly Keyed[], active: number): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        keys: tabs.map(orderKey),
        active: tabs[active] ? orderKey(tabs[active]) : "",
      }),
    );
  } catch {
    // Without storage the tabs come back in the order found.
  }
}

export function readTabOrder(docs: string | null = null): TabOrder {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as {
      keys?: unknown;
      ids?: unknown;
      active?: unknown;
    } | null;
    const active = typeof raw?.active === "string" ? raw.active : "";
    if (Array.isArray(raw?.keys))
      return {
        keys: raw.keys.map((k) => resolved(String(k), docs)),
        active: resolved(active, docs),
      };
    // 1.4.3's first builds kept the ids alone.
    const ids = Array.isArray(raw?.ids) ? raw.ids.map(String) : [];
    return {
      keys: ids.map((id) => `id:${id}`),
      active: active && `id:${active}`,
    };
  } catch {
    return { keys: [], active: "" };
  }
}

/** The documents the order had saved and open. */
export const savedPaths = (order: TabOrder): string[] =>
  order.keys.filter((k) => k.startsWith("path:")).map((k) => k.slice(5));

/** `tabs` with those the order knows put back in its order, in the places
 *  they took; the others stay where they are. */
export function inOrder<T>(
  tabs: readonly T[],
  keyOf: (tab: T) => string,
  keys: readonly string[],
): T[] {
  const rank = new Map(keys.map((k, i) => [k, i]));
  const rankOf = (tab: T) => rank.get(keyOf(tab)) ?? -1;
  const sorted = tabs
    .filter((tab) => rankOf(tab) >= 0)
    .sort((a, b) => rankOf(a) - rankOf(b));
  let next = 0;
  return tabs.map((tab) => (rankOf(tab) >= 0 ? sorted[next++]! : tab));
}
