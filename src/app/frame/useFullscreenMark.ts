import { useEffect, useState } from "react";
import { thisWindow } from "../../platform/this-window";

/**
 * Marks <html> with `data-window-fullscreen` while a Mac window is in full
 * screen and the traffic lights are gone, and says so. Driven by AppKit's
 * own event: guessing from the window size caught windows mid-transition.
 */
export function useFullscreenMark(): boolean {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.windowChrome !== "native") return;
    const mark = (on: boolean) => {
      if (on) root.dataset.windowFullscreen = "";
      else delete root.dataset.windowFullscreen;
      setFullscreen(on);
    };
    const win = thisWindow();
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
  return fullscreen;
}
