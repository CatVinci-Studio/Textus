import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Whether the window fills the whole screen, menu bar's strip included:
 *  full screen, as far as a page can tell. A zoomed window stops at the
 *  menu bar. */
function coversScreen(): boolean {
  return (
    window.innerWidth >= window.screen.width &&
    window.innerHeight >= window.screen.height
  );
}

/**
 * Marks <html> with `data-window-fullscreen` while a Mac window is in full
 * screen, where the traffic lights are gone from the window bar's corner
 * and its first control takes their place (window-bar.css). Elsewhere the
 * bar's left end is the same either way, so nothing is asked.
 *
 * The mark follows the window's size at once - the sidebar's button slides
 * over as the window settles, instead of waiting for the backend's answer
 * a moment later and jumping - and the backend's answer, once a resize has
 * settled, has the last word.
 */
export function useFullscreenMark(): void {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.windowChrome !== "native") return;
    const mark = (on: boolean) => {
      if (on) root.dataset.windowFullscreen = "";
      else delete root.dataset.windowFullscreen;
    };
    const win = getCurrentWindow();
    let alive = true;
    const confirm = () => {
      void win
        .isFullscreen()
        .then((on) => alive && mark(on))
        .catch(() => {
          // No backend (the browser build): the size alone decides.
        });
    };
    mark(coversScreen());
    confirm();
    let settle: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      mark(coversScreen());
      // A drag-resize fires this every frame; ask once it has stopped.
      clearTimeout(settle);
      settle = setTimeout(confirm, 100);
    };
    window.addEventListener("resize", onResize);
    return () => {
      alive = false;
      clearTimeout(settle);
      window.removeEventListener("resize", onResize);
      delete root.dataset.windowFullscreen;
    };
  }, []);
}
