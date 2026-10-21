import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Marks <html> with `data-window-fullscreen` while a Mac window is in full
 * screen, where the traffic lights are gone from the window bar's corner
 * and its first control takes their place (window-bar.css). Elsewhere the
 * bar's left end is the same either way, so nothing is asked.
 *
 * AppKit says when (`window-fullscreen`, watch_fullscreen in
 * src-tauri/src/lib.rs): once the window is in, and as it starts out.
 * Guessing from the window's size, and asking the backend after a resize,
 * caught a window still on its way out and left the button under the
 * lights.
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
    let stop: (() => void) | undefined;
    // A window opened in full screen (a tab torn off one) starts there.
    void win
      .isFullscreen()
      .then((on) => alive && mark(on))
      .catch(() => {
        // No backend (the browser build): never full screen.
      });
    void win
      .listen<boolean>("window-fullscreen", (event) => mark(event.payload))
      .then((unlisten) => {
        if (alive) stop = unlisten;
        else unlisten();
      })
      .catch(() => {});
    return () => {
      alive = false;
      stop?.();
      delete root.dataset.windowFullscreen;
    };
  }, []);
}
