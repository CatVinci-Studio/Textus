import { useEffect, useRef, type RefObject } from "react";
import { webPages } from "../../platform/ipc";
import { listenToThisWindow, unlistenAll } from "../../utils/tauri-events";
import { useLatest } from "../../utils/hooks/useLatest";
import { onWebPagesCover, webPagesCovered } from "./web-page-cover";

/**
 * Tab `id`'s web page as a native webview of its own
 * (commands/web_page.rs), laid over `holder` - its place in the tab - and
 * kept there as the layout changes: hidden while the tab is out of sight
 * or something of the window's is shown over it, closed with the tab.
 * `onNavigated` hears each address the page arrives at.
 */
export function useNativeWebPage(
  id: string,
  url: string,
  holder: RefObject<HTMLElement | null>,
  onNavigated: (url: string) => void,
) {
  // The address it opens at: later ones are the page's own to follow.
  const first = useRef(url);
  const navigated = useLatest(onNavigated);
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    let shown = false;
    let frame = 0;
    const place = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0 && !webPagesCovered();
      if (visible) {
        shown = true;
        void webPages
          .show(id, first.current, {
            x: r.left,
            y: r.top,
            width: r.width,
            height: r.height,
          })
          .catch(() => {});
      } else if (shown) {
        shown = false;
        void webPages.hide(id).catch(() => {});
      }
    };
    const sync = () => {
      frame ||= requestAnimationFrame(place);
    };
    // Its size changes with the window, the sidebar, a split's line; it
    // goes to nothing when its tab is hidden (display: none).
    const resized = new ResizeObserver(sync);
    resized.observe(el);
    window.addEventListener("resize", sync);
    const stopCover = onWebPagesCover(sync);
    const stopListening = unlistenAll(
      listenToThisWindow<{ id: string; url: string }>(
        "web-page-navigated",
        (event) => {
          if (event.payload.id === id) navigated.current(event.payload.url);
        },
      ),
    );
    sync();
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      window.removeEventListener("resize", sync);
      stopCover();
      stopListening();
      void webPages.close(id).catch(() => {});
    };
  }, [id, holder, navigated]);
}
