import { useSyncExternalStore } from "react";
import type { Rect } from "./rect";
import type { DividerRects } from "./solve";

/**
 * The islands as the solver last placed them, in the viewport's pixels:
 * what everything around the islands reads instead of measuring the page -
 * a drag's zones, the islands' numbers, a lifted island's copy. Written by
 * the islands' area after each solve.
 */
export interface FrameIsland {
  /** Its pane; null for the one island of a window not split. */
  paneId: string | null;
  /** Its key in the frame (its parts' data-frame). */
  key: string;
  row: Rect | null;
  sheet: Rect;
  whole: Rect;
  /** Its tabs in order and the one in front. */
  tabs: readonly string[];
  front: string | null;
}

export interface FrameLayout {
  islands: readonly FrameIsland[];
  dividers: readonly DividerRects[];
  /** The islands' box, inset from the area's sides. */
  area: Rect;
  /** Where the area's own (0, 0) is: what its parts are placed from. */
  origin: { x: number; y: number };
}

const EMPTY: FrameLayout = {
  islands: [],
  dividers: [],
  area: { x: 0, y: 0, w: 0, h: 0 },
  origin: { x: 0, y: 0 },
};

let current: FrameLayout = EMPTY;
const listeners = new Set<() => void>();

/** The islands placed as they now are; told only when that changed. */
export function setFrameLayout(next: FrameLayout): void {
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  for (const listener of listeners) listener();
}

export function frameLayout(): FrameLayout {
  return current;
}

export function onFrameLayout(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The islands as placed, kept current in a component. */
export function useFrameLayout(): FrameLayout {
  return useSyncExternalStore(onFrameLayout, frameLayout);
}
