import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Marks <html> with `data-window-fullscreen` while a Mac window is in full
 * screen, where the traffic lights are gone from the window bar's corner
 * and its first control takes their place (window-bar.css). Elsewhere the
 * bar's left end is the same either way, so nothing is asked.
 */
export function useFullscreenMark(): void {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.windowChrome !== "native") return;
    const win = getCurrentWindow();
    let alive = true;
    const sync = () => {
      void win
        .isFullscreen()
        .then((on) => {
          if (!alive) return;
          if (on) root.dataset.windowFullscreen = "";
          else delete root.dataset.windowFullscreen;
        })
        .catch(() => {
          // No backend (the browser build): never in full screen.
        });
    };
    sync();
    // Entering or leaving full screen resizes the window; a drag-resize
    // fires this every frame, and only where it ends matters.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const unlisten = win.onResized(() => {
      clearTimeout(settle);
      settle = setTimeout(sync, 100);
    });
    return () => {
      alive = false;
      clearTimeout(settle);
      void unlisten.then((off) => off()).catch(() => {});
      delete root.dataset.windowFullscreen;
    };
  }, []);
}
