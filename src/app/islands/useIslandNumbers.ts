import { tabElement } from "../../engine/layout/tab-element";
import { subscribeSplit, tabInUse } from "../../engine/layout/store";
import { useEffect } from "react";
import { watchIslandNumbers } from "../../engine/layout/island-numbers";
import { modIsMeta } from "../../platform/os";

/** What takes the keys in a tab: its editor, its source, the AI's box. */
const TYPED_IN = ".ProseMirror, .cm-content, textarea";

/** Puts the focus in `tabId`'s content once it is drawn in front - a tab
 *  just brought there mounts a frame or two later - or, where it has
 *  nothing to type in, on its tab. */
function focusTab(tabId: string, tries = 10): void {
  requestAnimationFrame(() => {
    const view = tabInUse() === tabId ? tabElement(tabId) : null;
    const target = view?.querySelector<HTMLElement>(TYPED_IN);
    if (target) target.focus({ preventScroll: true });
    else if (tries > 0) focusTab(tabId, tries - 1);
    else
      document
        .querySelector<HTMLElement>(
          `.tab-pill[data-tab="${CSS.escape(tabId)}"]`,
        )
        ?.focus({ preventScroll: true });
  });
}

/**
 * The islands' numbers (engine/layout/island-numbers.ts) in this window:
 * ⌘ held shows them, and a number pressed brings that island's tab to the
 * front with the focus in it.
 */
export function useIslandNumbers(setActiveTabId: (id: string) => void): void {
  useEffect(
    () =>
      watchIslandNumbers(modIsMeta(), (tabId) => {
        setActiveTabId(tabId);
        focusTab(tabId);
      }),
    [setActiveTabId],
  );
  // Any other way a tab comes to the front (Ctrl+Tab, closing one, a new
  // one): the focus follows where it would otherwise be lost with the view
  // that went out of sight.
  useEffect(() => {
    let was = tabInUse();
    return subscribeSplit(() => {
      const now = tabInUse();
      if (now === was) return;
      was = now;
      requestAnimationFrame(() => {
        if (focusLost()) focusTab(now);
      });
    });
  }, []);
}

/** Nothing has the keys, or what had them is gone from sight. */
function focusLost(): boolean {
  const at = document.activeElement;
  return (
    !at ||
    at === document.body ||
    !at.isConnected ||
    (at as HTMLElement).offsetParent === null
  );
}
