import { useSyncExternalStore } from "react";
import { thisWindow } from "./this-window";

/** The window as the system holds it: filling the screen, or full screen. */
export interface WindowState {
  maximized: boolean;
  fullscreen: boolean;
}

/**
 * The one watch on the window's state, for everything drawn by it (the
 * caption buttons, a Linux window's edges, the Mac's full-screen mark):
 * asked again where a resize ends - a drag fires one every frame, each
 * asking costs IPC round trips - and on AppKit's full-screen event.
 */
let state: WindowState = { maximized: false, fullscreen: false };
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

function set(next: Partial<WindowState>) {
  const merged = { ...state, ...next };
  if (
    merged.maximized === state.maximized &&
    merged.fullscreen === state.fullscreen
  )
    return;
  state = merged;
  for (const listener of listeners) listener();
}

function start(): () => void {
  const win = thisWindow();
  let alive = true;
  const sync = () =>
    void Promise.all([win.isMaximized(), win.isFullscreen()])
      .then(
        ([maximized, fullscreen]) => alive && set({ maximized, fullscreen }),
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
    .listen<boolean>("window-fullscreen", (event) =>
      set({ fullscreen: event.payload }),
    )
    .catch(() => () => {});
  return () => {
    alive = false;
    clearTimeout(settle);
    void resized.then((off) => off());
    void fullscreen.then((off) => off());
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  stop ??= start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop?.();
      stop = null;
    }
  };
}

export function useWindowState(): WindowState {
  return useSyncExternalStore(subscribe, () => state);
}
