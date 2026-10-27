import type { CaretPlace } from "./tab-caret";
import type { DocumentPlace } from "../plugins/app-bridge";

/**
 * Where a tab's editor should put the reader once it is on screen, handed
 * over by whoever opened the document. A new tab has no editor yet and a
 * hidden one can't scroll, so the jump waits until it is mounted and showing.
 */
export type TabJump =
  /** A followed `./other.md#heading` link: scroll to that heading. */
  | { kind: "heading"; anchor: string }
  /** A document reopened: the caret where it was left. */
  | { kind: "caret"; at: CaretPlace }
  /** A plugin opened it at a place: a block, a line, some words, a heading. */
  | { kind: "place"; place: DocumentPlace };

const pending = new Map<string, TabJump>();
const listeners = new Set<(tabId: string) => void>();

/**
 * Hands `jump` to the editor of `tabId`, replacing one it hasn't taken. It is
 * taken on the next mount or activation; `now` also tells an editor already
 * mounted and showing.
 */
export function setTabJump(tabId: string, jump: TabJump, now = false): void {
  pending.set(tabId, jump);
  if (now) for (const listener of listeners) listener(tabId);
}

export function takeTabJump(tabId: string): TabJump | null {
  const jump = pending.get(tabId) ?? null;
  pending.delete(tabId);
  return jump;
}

/** Called with the tab id of each jump set with `now`. Returns the
 *  unsubscribe. */
export function onTabJump(listener: (tabId: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
