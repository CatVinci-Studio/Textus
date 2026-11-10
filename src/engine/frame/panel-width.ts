import { useSyncExternalStore } from "react";

/**
 * The width a panel's island keeps (the AI's, Settings', a plugin page's),
 * in interface pixels before the interface scale: the one a divider was
 * last dragged to, kept for the next one opened, as VS Code keeps its
 * panel's. Per viewer, in localStorage.
 */
const KEY = "textus-panel-width";
export const PANEL_DEFAULT = 400;

let width = read();
const listeners = new Set<() => void>();

function read(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return n > 0 ? n : PANEL_DEFAULT;
  } catch {
    return PANEL_DEFAULT;
  }
}

export function panelWidth(): number {
  return width;
}

export function setPanelWidth(next: number): void {
  width = Math.round(next);
  try {
    localStorage.setItem(KEY, String(width));
  } catch {
    // Kept for this window.
  }
  for (const listener of listeners) listener();
}

export function usePanelWidth(): number {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, panelWidth);
}
