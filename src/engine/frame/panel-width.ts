import { useSyncExternalStore } from "react";
import { getUiState, setUiState } from "../../storage/ui-state";

/**
 * The width a panel keeps (the AI's island, Settings', a plugin page's; an
 * iPad's docked AI), in Medium's pixels: the
 * one it was last dragged to, kept for the next one opened, as VS Code
 * keeps its panel's. Its one owner; kept in the window's UI state.
 */
/** Before any panel was dragged: where a double-click on its edge puts it. */
export const PANEL_DEFAULT = 440;

let width = read();
const listeners = new Set<() => void>();

function read(): number {
  const n = Number(getUiState("panelPx"));
  return n > 0 ? n : PANEL_DEFAULT;
}

export function panelWidth(): number {
  return width;
}

/** `persist` false: drawn at it while a drag lasts, kept once it ends. */
export function setPanelWidth(next: number, persist = true): void {
  width = Math.round(next);
  if (persist) setUiState("panelPx", width);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const unwatched = () => () => {};

/** The width, kept current; `live` false reads it without drawing again
 *  as a drag moves it. */
export function usePanelWidth(live = true): number {
  return useSyncExternalStore(live ? subscribe : unwatched, panelWidth);
}
