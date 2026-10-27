/**
 * Whether a menu, dialog or picker is shown where a native web page might be.
 * A native page draws above everything, so pages hide while one is open.
 */

/** What covers: menus, dialogs and pickers. A hover card or note popover
 *  sits by its words in a document, never over a page. */
const COVERS =
  '[role="dialog"]:not(.hover-card, .review-note-popover), [role="alertdialog"], [role="menu"], [role="listbox"]';

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;
let covered = false;
let frame = 0;

function check() {
  frame = 0;
  const now = document.querySelector(COVERS) !== null;
  if (now === covered) return;
  covered = now;
  for (const listener of listeners) listener();
}

export function webPagesCovered(): boolean {
  return covered;
}

/** Told when the pages become covered or uncovered; watching starts with
 *  the first listener and stops with the last. */
export function onWebPagesCover(listener: () => void): () => void {
  listeners.add(listener);
  if (!observer) {
    observer = new MutationObserver(() => {
      frame ||= requestAnimationFrame(check);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    check();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
      covered = false;
    }
  };
}
