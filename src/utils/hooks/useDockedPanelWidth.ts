import { useSyncExternalStore } from "react";

/**
 * How wide the docked AI panel is right now - 0 while it is closed, lies
 * over the page or is the phone's sheet - for the few surfaces fixed to
 * the window that keep clear of it (the find bar, the tutorial card); App
 * sets it. They take it as their own `--docked-panel-width`. It used to be
 * a custom property on the app's shell, which every element of the window
 * inherits: setting it, on opening the panel and on every frame of
 * dragging its edge, recalculated the style of the whole document.
 */
let width = 0;
const listeners = new Set<() => void>();

export function setDockedPanelWidth(value: number) {
  if (value === width) return;
  width = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDockedPanelWidth(): number {
  return useSyncExternalStore(
    subscribe,
    () => width,
    () => 0,
  );
}
