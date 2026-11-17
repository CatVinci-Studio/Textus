import { useSyncExternalStore } from "react";
import { createSubscribers } from "../utils/store";
/**
 * Each tab's mounted editor, as the rest of the window may ask of it: its
 * live markdown and its caret. One handle a tab, its parts given by the
 * hooks that know them.
 */

/**
 * Where a caret is: an offset into the markdown, or in a large document
 * (where writing out the markdown before it was slow) its ProseMirror
 * position. Either holds only for the file as it was, so its modified time
 * is kept with it.
 */
export type CaretPlace = { offset: number } | { pos: number };

interface TabEditor {
  /** Pushes an unreported edit through; the live markdown, or null when
   *  the tab's `content` is current. */
  flush?: () => string | null;
  caret?: () => CaretPlace | null;
  /** Gives it the keys, its selection as it stands: the editor's own
   *  focus, which scrolls nothing. Given once the editor is built. */
  focus?: () => void;
  /** It must stay loaded though out of sight: Textus AI has Quick Ask
   *  open in it or is still writing into it. */
  held?: true;
}

const editors = new Map<string, TabEditor>();
const held = createSubscribers();

/** Gives `tabId`'s handle one of its parts; returns the take-back. */
export function registerTabEditor<K extends keyof TabEditor>(
  tabId: string,
  part: K,
  give: NonNullable<TabEditor[K]>,
): () => void {
  const handle = editors.get(tabId) ?? {};
  handle[part] = give;
  editors.set(tabId, handle);
  if (part === "held") held.publish();
  if (part === "focus") {
    const waiting = awaited.get(tabId);
    awaited.delete(tabId);
    waiting?.forEach((ready) => ready());
  }
  return () => {
    const now = editors.get(tabId);
    if (now?.[part] !== give) return;
    delete now[part];
    if (Object.keys(now).length === 0) editors.delete(tabId);
    if (part === "held") held.publish();
  };
}

const awaited = new Map<string, Set<() => void>>();

/** Gives `tabId`'s editor the keys; false while it isn't built. */
export function focusTabEditor(tabId: string): boolean {
  const focus = editors.get(tabId)?.focus;
  focus?.();
  return !!focus;
}

/** Calls `ready` once `tabId`'s editor is built; returns the cancel. */
export function whenEditorBuilt(tabId: string, ready: () => void): () => void {
  const waiting = awaited.get(tabId) ?? new Set();
  awaited.set(tabId, waiting.add(ready));
  return () => waiting.delete(ready);
}

/** Whether `tabId`'s editor is held loaded, kept current in a component. */
export function useEditorHeld(tabId: string): boolean {
  return useSyncExternalStore(held.subscribe, () => !!editors.get(tabId)?.held);
}

// Milkdown's listener reports markdown on a 200ms debounce with no maxWait,
// so a typing burst can leave the tab's `content` behind. Anything acting on
// `content` must first pull the live document through here.
export function flushEditor(tabId: string): string | null {
  return editors.get(tabId)?.flush?.() ?? null;
}

/** The caret of `tabId`'s mounted editor, or null. */
export function readTabCaret(tabId: string): CaretPlace | null {
  return editors.get(tabId)?.caret?.() ?? null;
}

// Each tab's caret as it leaves the screen, for reopening a document where
// it was left. It can also be read while open: a closing window has no
// other moment to tell.
let sink: ((tabId: string, caret: CaretPlace) => void) | null = null;

/** Where reported carets go; one per window. Returns the unregister. */
export function setTabCaretSink(
  receive: (tabId: string, caret: CaretPlace) => void,
): () => void {
  sink = receive;
  return () => {
    if (sink === receive) sink = null;
  };
}

/** An editor's caret as its tab leaves the screen. */
export function reportTabCaret(tabId: string, caret: CaretPlace | null): void {
  if (caret) sink?.(tabId, caret);
}
