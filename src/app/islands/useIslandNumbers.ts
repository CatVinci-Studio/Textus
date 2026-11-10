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
    const id = CSS.escape(tabId);
    // The tab's view, not its corner's readout, which carries its id too.
    const view = document.querySelector(
      `[data-active-tab][data-tab-id="${id}"]`,
    );
    const target = view?.querySelector<HTMLElement>(TYPED_IN);
    if (target?.getClientRects().length) target.focus({ preventScroll: true });
    else if (tries > 0) focusTab(tabId, tries - 1);
    else
      document
        .querySelector<HTMLElement>(`.tab-pill[data-tab="${id}"]`)
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
}
