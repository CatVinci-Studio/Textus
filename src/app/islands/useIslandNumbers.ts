import { tabElement } from "../../engine/layout/tab-element";
import { focusTabEditor, whenEditorBuilt } from "../../editor/tab-editor";
import { subscribeSplit, tabInUse } from "../../engine/layout/store";
import { useEffect } from "react";
import { watchIslandNumbers } from "../../engine/layout/island-numbers";
import { modIsMeta } from "../../platform/os";
import { mayTakeKeys } from "../../editor/take-keys";

/** What takes the keys in a tab besides a document's editor: its source,
 *  the AI's box. */
const TYPED_IN = ".cm-content, textarea";

/** Puts the focus in `tabId`'s content: a document's editor the moment it
 *  is built (tab-editor.ts) - a frame later, on a slow computer, keys typed
 *  meanwhile went nowhere; anything else once drawn in front, a frame or two
 *  later; with nothing to type in, its tab. `onlyIfLost`: only where the
 *  focus would be lost with the view that went out of sight. */
export function focusTab(
  tabId: string,
  keyed: boolean,
  onlyIfLost = false,
): void {
  const mayTake = () => (!onlyIfLost || focusLost()) && mayTakeKeys();
  if (mayTake() && focusTabEditor(tabId)) return;
  const cancel = whenEditorBuilt(tabId, () => {
    if (tabInUse() === tabId && focusLost()) focusTabEditor(tabId);
  });
  focusDrawn(tabId, keyed, mayTake, cancel);
}

/** `keyed`: it came by a key, so the tab shows the keyboard's ring when
 *  focused; by a click or a tap it shows none. */
function focusDrawn(
  tabId: string,
  keyed: boolean,
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
      return focusDrawn(tabId, keyed, mayTake, cancel, tries - 1);
    cancel();
    if (!mayTake()) return;
    const target = view?.querySelector<HTMLElement>(TYPED_IN);
    if (target) target.focus({ preventScroll: true });
    else if (tries > 0) focusDrawn(tabId, keyed, mayTake, () => {}, tries - 1);
    else
      document
        .querySelector<HTMLElement>(
          `.tab-pill[data-tab="${CSS.escape(tabId)}"]`,
        )
        // Said outright: WebKit and Chromium guess differently for a focus
        // moved by script.
        ?.focus({
          preventScroll: true,
          focusVisible: keyed,
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
        focusTab(tabId, true);
      }),
    [setActiveTabId],
  );
  // Any other way a tab comes to the front (Ctrl+Tab, closing one, a new
  // one): the focus follows where it would otherwise be lost with the view
  // that went out of sight.
  useEffect(() => {
    let was = tabInUse();
    // What came last, a key or a pointer: a tab closed by a click brings
    // the next to the front with no keyboard ring.
    let keyed = false;
    const key = () => (keyed = true);
    const point = () => (keyed = false);
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", point, true);
    const stop = subscribeSplit(() => {
      const now = tabInUse();
      if (now === was) return;
      was = now;
      focusTab(now, keyed, true);
    });
    return () => {
      stop();
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", point, true);
    };
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
