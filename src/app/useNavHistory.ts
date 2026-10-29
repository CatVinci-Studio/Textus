import { useEffect, useRef } from "react";
import type { DocTab } from "../document/doc-tabs";
import { modIsMeta } from "../platform/os";
import { comboFromEvent } from "../utils/shortcuts";
import { frontPlace, navHistory, tabScroller } from "../utils/nav-history";

/** Back: Ctrl+- on a Mac, as in Xcode and VS Code (⌘[ outdents a list item
 *  there); Alt+Left elsewhere. Forward adds Shift, or is Alt+Right. */
function stepOf(e: KeyboardEvent): -1 | 1 | null {
  if (modIsMeta()) {
    if (!e.ctrlKey || e.metaKey || e.altKey || e.code !== "Minus") return null;
    return e.shiftKey ? 1 : -1;
  }
  const combo = comboFromEvent(e);
  return combo === "alt+arrowleft" ? -1 : combo === "alt+arrowright" ? 1 : null;
}

/** Back and Forward between the places jumps left, by key and by the mouse's
 *  back and forward buttons. */
export function useNavHistory(opts: {
  tabsRef: { readonly current: readonly DocTab[] };
  activeTabId: string;
  setActiveTabId: (id: string) => void;
}): void {
  const { tabsRef, activeTabId, setActiveTabId } = opts;
  // How far down each tab was last seen: a tab just hidden reads 0.
  const tops = useRef(new Map<string, number>());
  const arriving = useRef<string | null>(null);
  const shown = useRef(activeTabId);

  useEffect(() => {
    const seen = (e: Event) => {
      const scroller = e.target;
      if (!(scroller instanceof HTMLElement) || scroller.clientHeight === 0)
        return;
      if (!scroller.classList.contains("editor-scroll")) return;
      const tabId =
        scroller.closest<HTMLElement>("[data-tab-id]")?.dataset.tabId;
      if (tabId) tops.current.set(tabId, scroller.scrollTop);
    };
    document.addEventListener("scroll", seen, { capture: true, passive: true });
    return () =>
      document.removeEventListener("scroll", seen, { capture: true });
  }, []);

  useEffect(() => {
    const left = shown.current;
    shown.current = activeTabId;
    if (arriving.current === activeTabId) {
      arriving.current = null;
      return;
    }
    if (left !== activeTabId && tabsRef.current.some((t) => t.id === left))
      navHistory.leave({ tabId: left, top: tops.current.get(left) ?? 0 });
  }, [activeTabId, tabsRef]);

  useEffect(() => {
    const go = (direction: -1 | 1) => {
      const alive = (id: string) => tabsRef.current.some((t) => t.id === id);
      const place = navHistory.step(direction, frontPlace(), alive);
      if (!place) return;
      if (place.tabId !== shown.current) {
        arriving.current = place.tabId;
        setActiveTabId(place.tabId);
      }
      // After the tab is shown and has put back its own scroll.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const scroller = tabScroller(place.tabId);
          if (scroller) scroller.scrollTop = place.top;
        }),
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const step = stepOf(e);
      if (step === null) return;
      e.preventDefault();
      go(step);
    };
    // The mouse's back (3) and forward (4) buttons.
    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      go(e.button === 3 ? -1 : 1);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [tabsRef, setActiveTabId]);
}
