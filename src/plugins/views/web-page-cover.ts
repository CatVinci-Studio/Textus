import { createSubscribers } from "../../utils/store";

/**
 * Whether a menu, dialog or picker is shown where a native web page might be.
 * A native page draws above everything, so pages hide while one is open.
 */

/** What covers: menus, dialogs and pickers. A hover card or note popover
 *  sits by its words in a document, and a plugin's floating view (the desk
 *  pet) stays up for good: neither hides a page. */
const COVERS =
  '[role="dialog"]:not(.hover-card, .review-note-popover, .floating-view), [role="alertdialog"], [role="menu"], [role="listbox"]';

let covered = false;
let frame = 0;
const subscribers = createSubscribers(() => {
  const observer = new MutationObserver(() => {
    frame ||= requestAnimationFrame(check);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  check();
  return () => {
    observer.disconnect();
    covered = false;
  };
});

function check() {
  frame = 0;
  const now = document.querySelector(COVERS) !== null;
  if (now === covered) return;
  covered = now;
  subscribers.publish();
}

export function webPagesCovered(): boolean {
  return covered;
}

/** Told when the pages become covered or uncovered; watching starts with
 *  the first listener and stops with the last. */
export const onWebPagesCover = subscribers.subscribe;
