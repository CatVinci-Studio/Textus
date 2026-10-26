import { useEffect, useRef } from "react";
import type { CaretPlace } from "../editor/tab-caret";
import { readTabCaret, setTabCaretSink } from "../editor/tab-caret";
import { onFlush } from "../storage/pending-writes";
import { getUiState, updateUiState, type UiState } from "../storage/ui-state";
import type { DocTab } from "./doc-tabs";

/**
 * Where the caret was in each recently left document, keyed by path with
 * the file's mtime: a file changed since opens at its top. Off when session
 * restore is off.
 */

type Stored = UiState["lastCarets"];
type Entry = Stored[string];

/** The documents remembered; the least recently left go first. */
const LIMIT = 50;
/** Carets reported in a burst (tab after tab) are written together. */
const WRITE_DELAY_MS = 1000;

/** Left in this window, newest last; `unwritten` are still to be sent. */
const local = new Map<string, Entry>();
const unwritten = new Set<string>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function isEntry(value: unknown): value is Entry {
  if (typeof value !== "object" || value === null) return false;
  const { mtime, offset, pos } = value as Record<string, unknown>;
  const place = (n: unknown) =>
    typeof n === "number" && Number.isInteger(n) && n >= 0;
  return typeof mtime === "number" && (place(offset) || place(pos));
}

/** A stored map, untrusted: what is valid. */
function validEntries(stored: unknown): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  if (typeof stored !== "object" || stored === null) return entries;
  for (const [path, entry] of Object.entries(stored))
    if (isEntry(entry)) entries.set(path, entry);
  return entries;
}

/** `stored` with this window's unwritten carets on top, the oldest dropped
 *  past LIMIT. */
export function mergeCarets(
  stored: unknown,
  newer: Map<string, Entry>,
  limit = LIMIT,
): Stored {
  const entries = validEntries(stored);
  for (const [path, entry] of newer) {
    entries.delete(path);
    entries.set(path, entry);
  }
  return Object.fromEntries([...entries].slice(-limit));
}

function writeCarets(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
  if (unwritten.size === 0) return;
  const newer = new Map([...unwritten].map((path) => [path, local.get(path)!]));
  unwritten.clear();
  // From the live copy: other windows remember documents too.
  updateUiState("lastCarets", (stored) => mergeCarets(stored, newer));
}

/** Remembers that `path`, as it was at `mtime`, was left at `caret`. */
export function rememberCaret(
  path: string,
  caret: CaretPlace,
  mtime: number,
): void {
  local.delete(path);
  local.set(path, { ...caret, mtime });
  unwritten.add(path);
  writeTimer ??= setTimeout(writeCarets, WRITE_DELAY_MS);
}

/** Where `path` was left, if the file is still as it was then. */
export function lastCaret(
  path: string,
  mtime: number | null,
): CaretPlace | null {
  if (mtime === null) return null;
  const entry =
    local.get(path) ?? validEntries(getUiState("lastCarets")).get(path);
  if (!entry || entry.mtime !== mtime) return null;
  return "pos" in entry ? { pos: entry.pos } : { offset: entry.offset };
}

/**
 * Remembers each caret this window's editors report, and asks again of each
 * shown tab on close: a tab autosaved since was remembered against the old
 * file.
 */
export function useLastCarets(
  tabs: DocTab[],
  activeTabId: string,
  enabled: boolean,
): void {
  // The tabs as of the last commit: a closed tab's editor reports its
  // caret as it unmounts, after the tab has left `tabs`.
  const known = useRef(new Map<string, DocTab>());
  useEffect(() => {
    known.current = new Map(tabs.map((tab) => [tab.id, tab]));
  }, [tabs]);
  const activeRef = useRef(activeTabId);
  useEffect(() => {
    activeRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    if (!enabled) return;
    // Tabs never shown keep what was stored: their caret isn't placed yet.
    const shown = new Set<string>();
    const remember = (tabId: string, caret: CaretPlace | null) => {
      const tab = known.current.get(tabId);
      // A Help guide is bundled, not a file the user left.
      if (!caret || !tab?.path || tab.helpDoc || tab.diskMtime === null) return;
      shown.add(tabId);
      rememberCaret(tab.path, caret, tab.diskMtime);
    };
    const stopSink = setTabCaretSink(remember);
    const stopFlush = onFlush(() => {
      for (const tabId of new Set([...shown, activeRef.current]))
        remember(tabId, readTabCaret(tabId));
      writeCarets();
    });
    return () => {
      stopSink();
      stopFlush();
    };
  }, [enabled]);
}

/** Forgets what wasn't written yet, for tests. */
export function resetLastCaretsForTests(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
  local.clear();
  unwritten.clear();
}
