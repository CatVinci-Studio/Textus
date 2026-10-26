import { useSyncExternalStore } from "react";

/**
 * How wide the docked AI panel is now (0 while closed, overlaid or a sheet),
 * for the few window-fixed surfaces that keep clear of it. Not a property on
 * the shell: setting that on every drag frame restyled the whole document.
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
