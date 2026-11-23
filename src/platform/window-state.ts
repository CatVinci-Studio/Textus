import { useSyncExternalStore } from "react";
import { createSubscribers } from "../utils/store";
import { thisWindow } from "./this-window";

/** The window as the system holds it: filling the screen, or full screen. */
interface WindowState {
  maximized: boolean;
  fullscreen: boolean;
}

/**
 * The one watch on the window's state, for everything drawn by it (the
 * caption buttons, a Linux window's edges, the Mac's full-screen mark):
 * asked again where a resize ends - a drag fires one every frame, each
 * asking costs IPC round trips - and on AppKit's full-screen event. Once
 * that event has come, full screen is taken from it alone: asked during the
 * system's animation, the window still answers the old state and would
 * undo the new one.
 */
let state: WindowState = { maximized: false, fullscreen: false };
const subscribers = createSubscribers(start);

function set(next: Partial<WindowState>) {
  const merged = { ...state, ...next };
  if (
    merged.maximized === state.maximized &&
    merged.fullscreen === state.fullscreen
  )
    return;
  state = merged;
  subscribers.publish();
}

function start(): () => void {
  const win = thisWindow();
  let alive = true;
  let told = false;
  const sync = () =>
    void Promise.all([win.isMaximized(), win.isFullscreen()])
      .then(
        ([maximized, fullscreen]) =>
          alive && set(told ? { maximized } : { maximized, fullscreen }),
      )
      .catch(() => {
        // No backend (the browser build): as it was.
      });
  sync();
  let settle: ReturnType<typeof setTimeout> | undefined;
  const resized = win.onResized(() => {
    clearTimeout(settle);
    settle = setTimeout(sync, 100);
  });
  const fullscreen = win
    .listen<boolean>("window-fullscreen", (event) => {
      told = true;
      set({ fullscreen: event.payload });
    })
    .catch(() => () => {});
  return () => {
    alive = false;
    clearTimeout(settle);
    void resized.then((off) => off());
    void fullscreen.then((off) => off());
  };
}

const subscribe = subscribers.subscribe;

export function useWindowState(): WindowState {
  return useSyncExternalStore(subscribe, () => state);
}
