/**
 * The window's tabs in order, kept past the app's end (Android ending it in
 * the background, where nothing else of the window survives): each by a
 * key - a page by what it is (the AI's), a saved document or a file a
 * plugin opens (a board, a database) by its path, a tab with unsaved text
 * by its id, its draft's.
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
  view?: { kind: string; view?: string; resource?: string };
  text?: unknown;
}

/** The file a tab keeps open: its document's, or a plugin's file editor's. */
export const keptFile = (tab: Keyed): string | null =>
  !tab.view
    ? tab.path
    : tab.view.kind === "editor"
      ? (tab.view.resource ?? null)
      : null;

function orderKey(tab: Keyed): string {
  const file = keptFile(tab);
  // Kept by its place in Documents: a reinstall moves an iOS app's folder.
  if (file && !tab.text)
    return `path:${storedDocumentPath(file, knownDocumentsDir())}`;
  if (tab.view) return `view:${tab.view.view ?? tab.view.kind}`;
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
