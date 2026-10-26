/**
 * Whether something of the window's is shown where a native web page
 * might be: a menu, a dialog, a list of choices. A native page is drawn
 * above everything of the window's own, so while one is open the pages go
 * out of sight (useNativeWebPage) and come back once it closes.
 */

/** What covers: the window's menus, dialogs (Settings among them) and
 *  pickers. A hover card or a note's popover sits by its words in a
 *  document, never over a page. */
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
