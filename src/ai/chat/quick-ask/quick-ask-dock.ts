import { useEffect, type RefObject } from "react";
import type { EditorView } from "@milkdown/kit/prose/view";
import { revealOffset } from "./useQuickAskReveal";
import { useLatest } from "../../../utils/hooks/useLatest";

/** On the root while the docked Quick Ask is up: the keyboard toolbar gives
 *  way to it, and the document scrolls clear of it. */
export const QUICK_ASK_DOCK_CLASS = "has-quick-ask-dock";

/**
 * The docked Quick Ask's footprint: while mounted the root carries
 * QUICK_ASK_DOCK_CLASS and `--quick-ask-dock-height`. `onResize` hears each
 * change so the editor can keep the passage being discussed above it.
 */
export function useQuickAskDock(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  onResize?: (first: boolean) => void,
): void {
  const onResizeRef = useLatest(onResize);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const root = document.documentElement;
    root.classList.add(QUICK_ASK_DOCK_CLASS);
    let first = true;
    const observer = new ResizeObserver(() => {
      root.style.setProperty("--quick-ask-dock-height", `${el.offsetHeight}px`);
      onResizeRef.current?.(first);
      first = false;
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.classList.remove(QUICK_ASK_DOCK_CLASS);
      root.style.removeProperty("--quick-ask-dock-height");
    };
  }, [ref, enabled, onResizeRef]);
}

/**
 * Scrolls `pos` into the strip between the editor's top and the docked panel;
 * ProseMirror's scrollIntoView counts the area behind the panel as visible.
 * Unless `force`, only while `pos` is within the editor, so a growing reply
 * doesn't drag back a document scrolled elsewhere.
 */
export function keepClearOfDock(
  view: EditorView,
  pos: number,
  force: boolean,
): void {
  const dock = document.querySelector(".quick-ask-dock");
  const scroller = view.dom.closest<HTMLElement>(".editor-scroll");
  if (!dock || !scroller) return;
  let at: { top: number; bottom: number };
  try {
    at = view.coordsAtPos(Math.min(pos, view.state.doc.content.size));
  } catch {
    return; // not laid out (a hidden tab)
  }
  const area = scroller.getBoundingClientRect();
  if (!force && (at.bottom < area.top || at.top > area.bottom)) return;
  const visible = { top: area.top, bottom: dock.getBoundingClientRect().top };
  scroller.scrollTop += revealOffset(at, visible);
}
