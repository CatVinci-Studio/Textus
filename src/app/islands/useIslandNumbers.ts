import { tabElement } from "../../engine/layout/tab-element";
import { focusTabEditor, whenEditorBuilt } from "../../editor/tab-editor";
import { subscribeSplit, tabInUse } from "../../engine/layout/store";
import { useEffect } from "react";
import { watchIslandNumbers } from "../../engine/layout/island-numbers";
import { modIsMeta } from "../../platform/os";
import { isMobileApp } from "../../platform/capabilities";

/** What takes the keys in a tab besides a document's editor: its source,
 *  the AI's box. */
const TYPED_IN = ".cm-content, textarea";

/** Puts the focus in `tabId`'s content once it is drawn in front - a tab
 *  just brought there mounts a frame or two later - or, where it has
 *  nothing to type in, on its tab. A document's editor takes it its own
 *  way (tab-editor.ts), as soon as it is built. */
function focusTab(tabId: string, tries = 10): void {
  requestAnimationFrame(() => {
    // Another tab is in use by now (a click elsewhere): the keys are its.
    if (tabInUse() !== tabId) return;
    const view = tabElement(tabId);
    if (view && focusTabEditor(tabId)) return;
    if (view?.querySelector(".editor-scroll")) {
      whenEditorBuilt(tabId, () => {
        if (tabInUse() === tabId && focusLost()) focusTabEditor(tabId);
      });
      return;
    }
    const target = view?.querySelector<HTMLElement>(TYPED_IN);
    if (target) target.focus({ preventScroll: true });
    else if (tries > 0) focusTab(tabId, tries - 1);
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
