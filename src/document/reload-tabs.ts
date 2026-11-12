import { useEffect, useRef } from "react";
import { tabIsDirty, type DocTab, type HelpDoc } from "./doc-tabs";
import type { PluginTabView } from "../plugins/app-bridge";

/**
 * What a window has open, kept in its sessionStorage: a reload of the page
 * (an error screen's Reload, a refresh while developing) comes back to the
 * same tabs, unsaved text included. Launch-time restore hands its documents
 * out once per run, so without this a reloaded window opened empty. A new
 * window starts with an empty sessionStorage, and so with none of this.
 */

const KEY = "textus-reload-tabs";

/** How long the tabs rest before they are written down again. */
const WRITE_MS = 1000;

/** One tab as kept: a saved document by its path alone, read again from
 *  disk; one with unsaved text, or none of its own, with its text; a
 *  plugin's view by what it shows. */
export interface KeptTab {
  /** The tab's id before the reload, whose draft is then let go. */
  id?: string;
  path: string | null;
  view?: PluginTabView;
  helpDoc?: HelpDoc;
  draftTitle?: string;
  sourceMode?: boolean;
  text?: { content: string; savedContent: string; diskMtime: number | null };
}

interface KeptTabs {
  tabs: KeptTab[];
  active: number;
}

/** The window's tabs; `withText` false keeps paths only (draft recovery
 *  switched off). */
export function keptTabs(
  tabs: DocTab[],
  activeTabId: string,
  withText: boolean,
): KeptTabs {
  const kept = tabs.map((tab): KeptTab => {
    if (tab.view) return { id: tab.id, path: tab.path, view: tab.view };
    const needsText = !tab.path || tabIsDirty(tab);
    return {
      id: tab.id,
      path: tab.path,
      ...(tab.helpDoc && { helpDoc: tab.helpDoc }),
      ...(tab.draftTitle && { draftTitle: tab.draftTitle }),
      ...(tab.sourceMode && { sourceMode: true }),
      ...(withText &&
        needsText &&
        !tab.helpDoc && {
          text: {
            content: tab.content,
            savedContent: tab.savedContent,
            diskMtime: tab.diskMtime,
          },
        }),
    };
  });
  return {
    tabs: kept,
    active: Math.max(
      0,
      tabs.findIndex((tab) => tab.id === activeTabId),
    ),
  };
}

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Writes the tabs down; past the storage's quota, without their text,
 *  so at least the documents come back. */
export function writeKeptTabs(kept: KeptTabs): void {
  const storage = store();
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(kept));
  } catch {
    try {
      // Without their ids too, so their drafts stay for the next launch.
      const paths = kept.tabs.map((tab) => ({
        ...tab,
        id: undefined,
        text: undefined,
      }));
      storage.setItem(KEY, JSON.stringify({ ...kept, tabs: paths }));
    } catch {
      storage.removeItem(KEY);
    }
  }
}

/** The tabs this page had before it was reloaded, or null for a new one. */
export function readKeptTabs(): KeptTabs | null {
  try {
    const raw = store()?.getItem(KEY);
    if (!raw) return null;
    const kept = JSON.parse(raw) as KeptTabs;
    return Array.isArray(kept.tabs) && kept.tabs.length > 0 ? kept : null;
  } catch {
    return null;
  }
}

// Until the launch-time restore has put the kept tabs back, the window's
// tabs are its blank start, not something to write over them.
let restored = false;
const whenRestored = new Set<() => void>();

export function keptTabsRestored(): void {
  restored = true;
  for (const done of whenRestored) done();
  whenRestored.clear();
}

/** Calls `done` once the launch-time restore has opened everything it
 *  opens (at once if it has); returns the cancel. */
export function afterStartupRestore(done: () => void): () => void {
  if (restored) {
    done();
    return () => {};
  }
  whenRestored.add(done);
  return () => whenRestored.delete(done);
}

/** Keeps this window's tabs written down while it runs: once they rest, and
 *  as the page goes away, with what the editors haven't reported yet
 *  (`liveTabs`). */
export function useKeepTabs(
  tabs: DocTab[],
  activeTabId: string,
  withText: boolean,
  liveTabs: () => DocTab[],
): void {
  const latest = useRef({ activeTabId, withText, liveTabs });
  latest.current = { activeTabId, withText, liveTabs };

  useEffect(() => {
    if (!restored) return;
    const timer = setTimeout(() => {
      const now = latest.current;
      writeKeptTabs(keptTabs(now.liveTabs(), now.activeTabId, now.withText));
    }, WRITE_MS);
    return () => clearTimeout(timer);
  }, [tabs, activeTabId, withText]);

  useEffect(() => {
    const write = () => {
      if (!restored) return;
      const now = latest.current;
      writeKeptTabs(keptTabs(now.liveTabs(), now.activeTabId, now.withText));
    };
    window.addEventListener("pagehide", write);
    return () => window.removeEventListener("pagehide", write);
  }, []);
}
