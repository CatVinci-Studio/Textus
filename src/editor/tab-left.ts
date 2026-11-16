import type { ScrollPlace } from "../document/last-places";
import type { LeftHistory } from "./left-history";

/**
 * What a tab's editor leaves as it goes (its tab no longer in front): its
 * document, selection, history and the place being read, for the tab's
 * next editor to open as this one was. The tab owns it, until it closes.
 */
export interface TabLeft {
  /** The text the document stands for: it holds for this text only. */
  markdown: string;
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

const left = new Map<string, TabLeft>();
const readings = new Map<string, Reading>();

/** The pane's part of what is left: it is the one that sees the scroll. */
export function leaveReading(tabId: string, reading: Reading): void {
  readings.set(tabId, reading);
}

export const readingLeft = (tabId: string): Reading | null =>
  readings.get(tabId) ?? null;

export function leaveTab(tabId: string, state: TabLeft): void {
  left.set(tabId, state);
}

/** What `tabId`'s last editor left, if the tab still reads `markdown`. */
export function leftBy(tabId: string, markdown: string): TabLeft | null {
  const state = left.get(tabId);
  return state?.markdown === markdown ? state : null;
}

/** The tab closed, or its editor took what was left: nothing kept twice. */
export function forgetLeft(tabId: string): void {
  left.delete(tabId);
  readings.delete(tabId);
}
