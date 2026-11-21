import type { ScrollPlace } from "../document/last-places";
import type { LeftHistory } from "./left-history";
import { windowTabs } from "../engine/layout/store";
import type { SingleTildeMode } from "../prefs/settings-values";

/** Kept only for a tab still open: an editor going because its tab closed
 *  leaves nothing behind (the window's model drops the tab first). */
const open = (tabId: string) => windowTabs().some((tab) => tab.id === tabId);

/**
 * What a tab's editor leaves as it goes (its tab no longer in front): its
 * document, selection, history and the place being read, for the tab's
 * next editor to open as this one was. The tab owns it, until it closes.
 */
export interface TabLeft {
  /** The file it was (null for a draft): another file in the tab, as a
   *  look replaced, starts afresh. */
  path: string | null;
  /** The text the document stands for: it holds for this text only. */
  markdown: string;
  /** How one tilde was read (Settings › Editing): read another way now,
   *  the text is parsed afresh. */
  singleTilde: SingleTildeMode;
  doc: unknown;
  selection: unknown;
  history: LeftHistory | null;
}

/** Where a document is read: its scroll at a pane width, and the block at
 *  the top for another width. */
export interface Reading {
  top: number;
  width: number;
  place: ScrollPlace | null;
}

/** The find bar as its tab's editor left it. */
interface FindLeft {
  open: boolean;
  query: string;
  replacement: string;
  caseSensitive: boolean;
  useRegex: boolean;
  replaceOpen: boolean;
}

const left = new Map<string, TabLeft>();
const readings = new Map<string, Reading>();
const finds = new Map<string, FindLeft>();

/** What a tab's source view leaves: its state as CodeMirror writes it out
 *  (the text, selection and undo history) and where it was scrolled to,
 *  as CodeMirror's own effect that takes a view back there. */
interface SourceLeft {
  state: unknown;
  text: string;
  scroll: unknown;
}
const sources = new Map<string, SourceLeft>();

export function leaveSource(tabId: string, left: SourceLeft): void {
  if (open(tabId)) sources.set(tabId, left);
}

/** What `tabId`'s last source view left, if the tab still reads `text`. */
export function sourceLeftBy(tabId: string, text: string): SourceLeft | null {
  const left = sources.get(tabId);
  return left?.text === text ? left : null;
}

export function leaveFind(tabId: string, find: FindLeft): void {
  if (open(tabId)) finds.set(tabId, find);
}

export const findLeft = (tabId: string): FindLeft | null =>
  finds.get(tabId) ?? null;

/** The pane's part of what is left: it is the one that sees the scroll. */
export function leaveReading(tabId: string, reading: Reading): void {
  if (open(tabId)) readings.set(tabId, reading);
}

export const readingLeft = (tabId: string): Reading | null =>
  readings.get(tabId) ?? null;

export function leaveTab(tabId: string, state: TabLeft): void {
  if (open(tabId)) left.set(tabId, state);
}

/** What `tabId`'s last editor left, if the tab still reads `markdown`. */
export function leftBy(tabId: string, markdown: string): TabLeft | null {
  const state = left.get(tabId);
  return state?.markdown === markdown ? state : null;
}

/** What `tabId`'s last editor left for the file at `path`, read the way
 *  the next editor reads one tilde, whatever its text now: a change made meanwhile (in source mode) is applied over it
 *  as one more step. */
export function leftAtAll(
  tabId: string,
  path: string | null,
  singleTilde: SingleTildeMode,
): TabLeft | null {
  const state = left.get(tabId);
  return state?.path === path && state.singleTilde === singleTilde
    ? state
    : null;
}

/** The tab closed, or its editor took what was left: nothing kept twice. */
export function forgetLeft(tabId: string): void {
  left.delete(tabId);
  readings.delete(tabId);
  finds.delete(tabId);
  sources.delete(tabId);
}
