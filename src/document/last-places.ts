import { useEffect, useRef } from "react";
import type { CaretPlace } from "../editor/tab-editor";
import { readTabCaret, setTabCaretSink } from "../editor/tab-editor";
import { onFlush } from "../storage/pending-writes";
import { getUiState, updateUiState, type UiState } from "../storage/ui-state";
import type { DocTab } from "./doc-tabs";
import { tabInUse } from "../engine/layout/store";

/**
 * Where each recently left document was: its caret and the place it was
 * being read at (a block and how far into it, as scrollTop moves with the
 * window's width), keyed by path with the file's mtime - a file changed
 * since opens at its top. Off when session restore is off.
 */

type Stored = UiState["lastCarets"];
type Entry = Stored[string];
/** A place a document was being read at. */
export type ScrollPlace = { block: number; into: number };

/** The documents remembered; the least recently left go first. */
const LIMIT = 100;
/** Carets reported in a burst (tab after tab) are written together. */
const WRITE_DELAY_MS = 1000;

/** Left in this window, newest last; `unwritten` are still to be sent. */
const local = new Map<string, Entry>();
const unwritten = new Set<string>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;
/** Session restore is on: places are kept (useLastPlaces). */
let keeping = false;

const whole = (n: unknown) =>
  typeof n === "number" && Number.isInteger(n) && n >= 0;

function isEntry(value: unknown): value is Entry {
  if (typeof value !== "object" || value === null) return false;
  const { mtime, offset, pos, scroll } = value as Record<string, unknown>;
  const read = scroll as Record<string, unknown> | undefined;
  return (
    typeof mtime === "number" &&
    (whole(offset) ||
      whole(pos) ||
      (!!read && whole(read.block) && typeof read.into === "number"))
  );
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

/** `path`'s entry as it is now kept, here or stored. */
function entryOf(path: string): Entry | undefined {
  return local.get(path) ?? validEntries(getUiState("lastCarets")).get(path);
}

/** `path`, as it was at `mtime`, remembered with `part` over what was
 *  kept of it then (a different mtime keeps nothing). */
function remember(path: string, mtime: number, part: Partial<Entry>): void {
  const was = entryOf(path);
  const kept = was && was.mtime === mtime ? was : { mtime };
  local.delete(path);
  local.set(path, { ...kept, ...part, mtime } as Entry);
  unwritten.add(path);
  writeTimer ??= setTimeout(writeCarets, WRITE_DELAY_MS);
}

/** Remembers that `path`, as it was at `mtime`, was left at `caret`. */
export function rememberCaret(
  path: string,
  caret: CaretPlace,
  mtime: number,
): void {
  const part =
    "pos" in caret
      ? { pos: caret.pos, offset: undefined }
      : { offset: caret.offset, pos: undefined };
  remember(path, mtime, part);
}

/** Remembers where `path`, as it was at `mtime`, was being read; its top
 *  is no place to remember. */
export function rememberScroll(
  path: string,
  place: ScrollPlace,
  mtime: number,
): void {
  if (!keeping) return;
  const top = place.block === 0 && place.into < 1;
  remember(path, mtime, { scroll: top ? undefined : place });
}

/** Where `path` was left, if the file is still as it was then. */
export function lastCaret(
  path: string,
  mtime: number | null,
): CaretPlace | null {
  const entry = mtime === null ? undefined : entryOf(path);
  if (!entry || entry.mtime !== mtime) return null;
  if (whole(entry.pos)) return { pos: entry.pos! };
  return whole(entry.offset) ? { offset: entry.offset! } : null;
}

/** Where `path` was being read, if the file is still as it was then. */
export function lastScroll(
  path: string,
  mtime: number | null,
): ScrollPlace | null {
  const entry = mtime === null || !keeping ? undefined : entryOf(path);
  return (entry && entry.mtime === mtime && entry.scroll) || null;
}

/**
 * Remembers each caret this window's editors report, and asks again of each
 * shown tab on close: a tab autosaved since was remembered against the old
 * file.
 */
export function useLastPlaces(tabs: DocTab[], enabled: boolean): void {
  // The tabs as of the last commit: a closed tab's editor reports its
  // caret as it unmounts, after the tab has left `tabs`.
  const known = useRef(new Map<string, DocTab>());
  useEffect(() => {
    known.current = new Map(tabs.map((tab) => [tab.id, tab]));
  }, [tabs]);

  useEffect(() => {
    keeping = enabled;
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
      for (const tabId of new Set([...shown, tabInUse()]))
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
export function resetLastPlacesForTests(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
  local.clear();
  unwritten.clear();
}
