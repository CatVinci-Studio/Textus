import { tabElement } from "../../engine/layout/tab-element";
import { focusTabEditor, whenEditorBuilt } from "../../editor/tab-editor";
import { subscribeSplit, tabInUse } from "../../engine/layout/store";
import { useEffect } from "react";
import { watchIslandNumbers } from "../../engine/layout/island-numbers";
import { modIsMeta } from "../../platform/os";
import { isMobileApp } from "../../platform/capabilities";
import { mayTakeKeys } from "../../editor/take-keys";

/** What takes the keys in a tab besides a document's editor: its source,
 *  the AI's box. */
const TYPED_IN = ".cm-content, textarea";

/** Puts the focus in `tabId`'s content: a document's editor the moment it
 *  is built (tab-editor.ts) - a frame later, on a slow computer, keys typed
 *  meanwhile went nowhere; anything else once drawn in front, a frame or two
 *  later; with nothing to type in, its tab. `onlyIfLost`: only where the
 *  focus would be lost with the view that went out of sight. */
function focusTab(tabId: string, onlyIfLost = false): void {
  const mayTake = () => (!onlyIfLost || focusLost()) && mayTakeKeys();
  if (mayTake() && focusTabEditor(tabId)) return;
  const cancel = whenEditorBuilt(tabId, () => {
    if (tabInUse() === tabId && focusLost()) focusTabEditor(tabId);
  });
  focusDrawn(tabId, mayTake, cancel);
}

function focusDrawn(
  tabId: string,
  mayTake: () => boolean,
  cancel: () => void,
  tries = 10,
): void {
  requestAnimationFrame(() => {
    // Another tab is in use by now (a click elsewhere): the keys are its.
    if (tabInUse() !== tabId) return cancel();
    const view = tabElement(tabId);
    // A document's: its editor takes them when built, or did.
    if (view?.querySelector(".editor-scroll")) return;
    if (!view && tries > 0)
      return focusDrawn(tabId, mayTake, cancel, tries - 1);
    cancel();
    if (!mayTake()) return;
    const target = view?.querySelector<HTMLElement>(TYPED_IN);
    if (target) target.focus({ preventScroll: true });
    else if (tries > 0) focusDrawn(tabId, mayTake, () => {}, tries - 1);
    else
      document
        .querySelector<HTMLElement>(
          `.tab-pill[data-tab="${CSS.escape(tabId)}"]`,
        )
        // On a touch screen it came by a tap: no keyboard ring (WebKit
        // drew one for this programmatic focus).
        ?.focus({
          preventScroll: true,
          focusVisible: !isMobileApp,
        } as FocusOptions);
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
      focusTab(now, true);
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
