import { useEffect, useRef, useState, type RefObject } from "react";
import { webPages } from "../../platform/ipc";
import { listenToThisWindow, unlistenAll } from "../../platform/events";
import { useLatest } from "../../utils/hooks/useLatest";
import { onWebPagesCover, webPagesCovered } from "./web-page-cover";

/** A load that hasn't finished by then failed (no network, a refused
 *  certificate): WebKit says nothing, the page stays blank. */
const LOAD_MS = 15_000;
/** Each loaded page is a WebKit process of its own, up to a few hundred MB:
 *  one out of sight this long is let go, and no more than this many stay
 *  loaded. Shown again, it loads its last address. */
const HIDDEN_KEPT_MS = 5 * 60_000;
const MAX_LOADED = 3;

interface Loaded {
  visible: boolean;
  seen: number;
  unload: () => void;
}
const loaded = new Map<string, Loaded>();

function unloadExtra() {
  const hidden = [...loaded.values()]
    .filter((page) => !page.visible)
    .sort((a, b) => a.seen - b.seen);
  while (loaded.size > MAX_LOADED && hidden.length) hidden.shift()!.unload();
}

/**
 * Tab `id`'s web page as a native webview laid over `holder` and kept there
 * as the layout changes: hidden while out of sight or covered, let go when
 * long out of sight, closed with the tab. `onNavigated` hears each address
 * it arrives at; `failed` is a load that never finished, with `retry`.
 */
export function useNativeWebPage(
  id: string,
  url: string,
  holder: RefObject<HTMLElement | null>,
  onNavigated: (url: string) => void,
) {
  // The address it opens at, then the last it arrived at.
  const last = useRef(url);
  const navigated = useLatest(onNavigated);
  const [failed, setFailed] = useState(false);
  const failedRef = useLatest(failed);
  const sync = useRef<() => void>(() => {});
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    let shown = false;
    let frame = 0;
    let hiddenTimer = 0;
    let loadTimer = 0;
    const page: Loaded = {
      visible: false,
      seen: Date.now(),
      unload: () => {
        loaded.delete(id);
        clearTimeout(hiddenTimer);
        void webPages.close(id).catch(() => {});
      },
    };
    const place = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const visible =
        r.width > 0 && r.height > 0 && !webPagesCovered() && !failedRef.current;
      if (visible) {
        shown = true;
        page.visible = true;
        page.seen = Date.now();
        clearTimeout(hiddenTimer);
        loaded.set(id, page);
        unloadExtra();
        void webPages
          .show(id, last.current, {
            x: r.left,
            y: r.top,
            width: r.width,
            height: r.height,
          })
          .catch(() => {});
      } else if (shown) {
        shown = false;
        page.visible = false;
        page.seen = Date.now();
        clearTimeout(hiddenTimer);
        hiddenTimer = window.setTimeout(page.unload, HIDDEN_KEPT_MS);
        void webPages.hide(id).catch(() => {});
      }
    };
    sync.current = () => {
      frame ||= requestAnimationFrame(place);
    };
    const resized = new ResizeObserver(() => sync.current());
    resized.observe(el);
    const onResize = () => sync.current();
    window.addEventListener("resize", onResize);
    const stopCover = onWebPagesCover(onResize);
    const stopListening = unlistenAll(
      listenToThisWindow<{ id: string; url: string; loading?: boolean }>(
        "web-page-navigated",
        (event) => {
          if (event.payload.id !== id) return;
          clearTimeout(loadTimer);
          if (event.payload.loading) {
            loadTimer = window.setTimeout(() => setFailed(true), LOAD_MS);
            return;
          }
          last.current = event.payload.url;
          setFailed(false);
          navigated.current(event.payload.url);
        },
      ),
    );
    sync.current();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(loadTimer);
      resized.disconnect();
      window.removeEventListener("resize", onResize);
      stopCover();
      stopListening();
      page.unload();
    };
  }, [id, holder, navigated, failedRef]);
  // Failed, the page is hidden for the message; shown again to retry.
  useEffect(() => sync.current(), [failed]);
  return {
    failed,
    retry: () => {
      setFailed(false);
      void webPages.reload(id).catch(() => {});
    },
  };
}
