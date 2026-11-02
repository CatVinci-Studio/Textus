import { useEffect, useRef } from "react";
import { tabIsDirty, type DocTab, type HelpDoc } from "./doc-tabs";

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
 *  disk; one with unsaved text, or none of its own, with its text. */
export interface KeptTab {
  path: string | null;
  helpDoc?: HelpDoc;
  draftTitle?: string;
  sourceMode?: boolean;
  text?: { content: string; savedContent: string; diskMtime: number | null };
}

export interface KeptTabs {
  tabs: KeptTab[];
  active: number;
}

/** The tabs worth keeping, plugin views aside; `withText` false keeps paths
 *  only (draft recovery switched off). */
export function keptTabs(
  tabs: DocTab[],
  activeTabId: string,
  withText: boolean,
): KeptTabs {
  const shown = tabs.filter((tab) => !tab.view);
  const kept = shown.map((tab): KeptTab => {
    const needsText = !tab.path || tabIsDirty(tab);
    return {
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
      shown.findIndex((tab) => tab.id === activeTabId),
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
      const paths = kept.tabs.map((tab) => ({ ...tab, text: undefined }));
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

export function keptTabsRestored(): void {
  restored = true;
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
