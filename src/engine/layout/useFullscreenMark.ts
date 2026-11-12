import { useEffect } from "react";
import { useWindowState } from "../../platform/window-state";

/**
 * Marks <html> with `data-window-fullscreen` while a Mac window is in full
 * screen and the traffic lights are gone, and says so: AppKit's own event,
 * through the window's state (guessing from the window size caught windows
 * mid-transition).
 */
export function useFullscreenMark(): boolean {
  const native = document.documentElement.dataset.windowChrome === "native";
  const fullscreen = useWindowState().fullscreen && native;
  useEffect(() => {
    const root = document.documentElement;
    if (!fullscreen) return;
    root.dataset.windowFullscreen = "";
    return () => {
      delete root.dataset.windowFullscreen;
    };
  }, [fullscreen]);
  return fullscreen;
}
