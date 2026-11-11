import { useEffect } from "react";
import { unlistenAll } from "../platform/events";
import { thisWindow } from "../platform/this-window";

/** The documents' scrollers: rendered, the split's preview, source. */
const SCROLLERS =
  ".main-pane :is(.editor-scroll, .split-preview, .source-view .cm-scroller)";

/** How long after the window comes back a scroll the reader didn't make is
 *  taken back: the webview's own, as it puts the focus back at the caret. */
const SETTLE_MS = 400;

/**
 * Coming back to the window from another app leaves each document where it
 * was being read: the webview, giving the editor its focus back, scrolls to
 * the caret (at the end, say, while the reader was further up).
 */
export function useHoldScrollOnReturn(): void {
  useEffect(() => {
    let kept = new Map<HTMLElement, number>();
    let until = 0;
    let stop = () => {};
    const keep = () => {
      kept = new Map(
        [...document.querySelectorAll<HTMLElement>(SCROLLERS)].map((el) => [
          el,
          el.scrollTop,
        ]),
      );
    };
    const putBack = (el: HTMLElement) => {
      const top = kept.get(el);
      if (top !== undefined && el.scrollTop !== top) el.scrollTop = top;
    };
    const onScroll = (e: Event) => {
      if (performance.now() > until) return stop();
      if (e.target instanceof HTMLElement) putBack(e.target);
    };
    // The reader's own move ends the hold at once; a click that brought
    // the window back (onto the outline, say) means to go somewhere.
    const release = () => stop();
    let pressedAt = 0;
    const pressed = () => (pressedAt = performance.now());
    window.addEventListener("pointerdown", pressed, true);
    const back = () => {
      stop();
      if (performance.now() - pressedAt < SETTLE_MS) return;
      until = performance.now() + SETTLE_MS;
      for (const el of kept.keys()) putBack(el);
      document.addEventListener("scroll", onScroll, true);
      for (const type of ["wheel", "pointerdown", "keydown", "touchstart"])
        window.addEventListener(type, release, true);
      stop = () => {
        until = 0;
        document.removeEventListener("scroll", onScroll, true);
        for (const type of ["wheel", "pointerdown", "keydown", "touchstart"])
          window.removeEventListener(type, release, true);
      };
    };
    // The window's own focus, not the page's: a plugin's frame taking the
    // keys is not leaving.
    const unlisten = thisWindow().onFocusChanged(({ payload: focused }) =>
      focused ? back() : keep(),
    );
    return () => {
      stop();
      unlistenAll(unlisten)();
      window.removeEventListener("pointerdown", pressed, true);
    };
  }, []);
}
