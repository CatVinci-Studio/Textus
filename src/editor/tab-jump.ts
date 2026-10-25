import type { CaretPlace } from "./tab-caret";
import type { DocumentPlace } from "../plugins/app-bridge";

/**
 * Where a tab's editor should put the reader once it is on screen: handed
 * over by whoever opened the document (app/useFileOpening.ts), taken by the
 * tab's editor (useTabJump.ts) - the way mode-switch.ts hands a caret
 * across a source/WYSIWYG switch. A tab that opens new has no editor yet,
 * and a hidden one can't scroll, so the jump waits for the editor of that
 * tab to be mounted and showing.
 */
export type TabJump =
  /** A followed `./other.md#heading` link: scroll to that heading. */
  | { kind: "heading"; anchor: string }
  /** A document reopened (the last session, Open Recent): the caret where
   *  it was left (tab-caret.ts). */
  | { kind: "caret"; at: CaretPlace }
  /** A plugin opened it at a place (textus.layout.open): a block, a line,
   *  some words, a heading (document-view/plugin-edits.ts). */
  | { kind: "place"; place: DocumentPlace };

const pending = new Map<string, TabJump>();
const listeners = new Set<(tabId: string) => void>();

/**
 * Hands `jump` to the editor of `tabId`, replacing one it hasn't taken.
 * That editor takes it when it next mounts or becomes the active tab;
 * `now` also tells an editor already mounted and showing (a link into the
 * tab on screen), which nothing else would make look.
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
