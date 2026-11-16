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

/** How a layout fits the islands' area: `short`, the pixels it lacks with
 *  each island at its least (0 or less: it fits); `panels`, what folding
 *  its panels' islands into their neighbours would give. */
export interface RoomCheck {
  short: number;
  panels: number;
  /** Short of height, which nothing gives: no width would do. */
  low?: boolean;
}

let check: ((root: LayoutNode) => RoomCheck) | null = null;
/** The width the sidebar would give, stepping aside (0 when shut). */
let sidebarRoom = 0;
/** A split made into too little room: first the panels' islands fold,
 *  then the sidebar steps aside; null when nothing gives way. */
let givingWay: "panels" | "sidebar" | null = null;

/** Told by the islands' area after each solve. */
export function setLayoutFits(next: (root: LayoutNode) => RoomCheck): void {
  check = next;
}

/** Told by the window's frame: what the sidebar gives by stepping aside. */
export function setSidebarRoom(room: number): void {
  sidebarRoom = room;
}

/** A phone shows one island: a split never fits there. */
function roomFor(root: LayoutNode): RoomCheck {
  if (root.kind === "split" && isPhoneLayout())
    return { short: Infinity, panels: 0 };
  return check ? check(root) : { short: 0, panels: 0 };
}

/** Whether a layout's islands, each at its least, fit the area as it is. */
export function layoutFits(root: LayoutNode): boolean {
  return roomFor(root).short <= 0.5;
}

/** The pixels `root` lacks once the panels' islands fold and the sidebar
 *  steps aside: 0 when it fits so. A split asked for is made then, and
 *  they give way (useNarrowIslands, useNarrowSidebar). */
export function shortGivingWay(root: LayoutNode): number {
  const { short, panels, low } = roomFor(root);
  lastLow = !!low;
  return Math.max(0, Math.ceil(short - panels - sidebarRoom - 0.5));
}

let lastLow = false;
/** Whether the last layout refused lacked height, not width: what the
 *  window says about it (sayNoRoom). */
export function refusedForHeight(): boolean {
  return lastLow;
}

/** A layout set into too little room: the panels, then the sidebar, give
 *  way until it fits, rather than the islands waiting for the window. */
export function askGiveWay(): void {
  givingWay = "panels";
}

/** Who gives way now. */
export function givingWayNow(): "panels" | "sidebar" | null {
  return givingWay;
}

/** The panels have folded what they can: done when the layout now fits,
 *  else the sidebar's turn. */
export function panelsGaveWay(fits: boolean): void {
  if (givingWay === "panels") givingWay = fits ? null : "sidebar";
}

/** The sidebar has heard its turn. */
export function sidebarGaveWay(): void {
  if (givingWay === "sidebar") givingWay = null;
}
