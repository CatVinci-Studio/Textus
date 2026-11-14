import { useSyncExternalStore } from "react";
import type { Rect } from "./rect";
import type { LayoutNode } from "../layout/tree";
import { isPhoneLayout } from "../../platform/phone-layout";

/**
 * The islands as the solver last placed them, in the viewport's pixels:
 * what everything around the islands reads instead of measuring the page -
 * a drag's zones, the islands' numbers, a lifted island's copy. Written by
 * the islands' area after each solve.
 */
export interface FrameIsland {
  /** Its pane: every island has one, a window unsplit its only one. */
  paneId: string;
  /** Its key in the frame (its parts' data-frame). */
  key: string;
  row: Rect | null;
  sheet: Rect;
  whole: Rect;
}

interface FrameLayout {
  islands: readonly FrameIsland[];
  /** Where the area's own (0, 0) is: what its parts are placed from. */
  origin: { x: number; y: number };
  /** The width the islands need at the least (their minimums, the gaps
   *  and insets): what the docks beside them leave room for; 0 unknown. */
  need: number;
}

const EMPTY: FrameLayout = {
  islands: [],
  origin: { x: 0, y: 0 },
  need: 0,
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

function onFrameLayout(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The islands as placed, kept current in a component. */
export function useFrameLayout(): FrameLayout {
  return useSyncExternalStore(onFrameLayout, frameLayout);
}

const needNow = () => current.need;

/** The width the islands need, kept current: told only when it changes,
 *  not as islands move. */
export function useIslandsNeed(): number {
  return useSyncExternalStore(onFrameLayout, needNow);
}

/** The island whose row of tabs holds the viewport point, if any. */
export function rowIslandAt(x: number, y: number): FrameIsland | null {
  return (
    current.islands.find(
      ({ row: r }) =>
        !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h,
    ) ?? null
  );
}

/** The island whose box holds the viewport point, if any. */
export function islandAt(x: number, y: number): FrameIsland | null {
  return (
    current.islands.find(
      ({ whole: r }) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h,
    ) ?? null
  );
}

let fits: ((root: LayoutNode) => boolean) | null = null;

/** Whether a layout's islands, each at its least, fit the area as it
 *  stands: told by the islands' area after each solve. */
export function setLayoutFits(check: (root: LayoutNode) => boolean): void {
  fits = check;
}

/** A phone shows one island: a split never fits there. */
export function layoutFits(root: LayoutNode): boolean {
  if (root.kind === "split" && isPhoneLayout()) return false;
  return fits ? fits(root) : true;
}
