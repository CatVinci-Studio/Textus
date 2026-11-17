import { useSyncExternalStore } from "react";
import type { Rect } from "./rect";
import type { LayoutNode } from "../layout/tree";
import { isPhoneLayout } from "../../platform/phone-layout";
import { createSubscribers } from "../../utils/store";

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
const subscribers = createSubscribers();

/** The islands placed as they now are; told only when that changed. */
export function setFrameLayout(next: FrameLayout): void {
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  subscribers.publish();
}

export function frameLayout(): FrameLayout {
  return current;
}

const onFrameLayout = subscribers.subscribe;

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

let check: ((root: LayoutNode, keep: ReadonlySet<string>) => RoomCheck) | null =
  null;
/** The width the sidebar would give, stepping aside (0 when shut). */
let sidebarRoom = 0;
/** A split made into too little room: first the panels' islands fold,
 *  then the sidebar steps aside; null when nothing gives way. */
let givingWay: "panels" | "sidebar" | null = null;
/** The islands the change being made room for made: never folded for it,
 *  or it would come undone as soon as it was made. */
let kept: ReadonlySet<string> = new Set();

/** Told by the islands' area after each solve. */
export function setLayoutFits(
  next: (root: LayoutNode, keep: ReadonlySet<string>) => RoomCheck,
): void {
  check = next;
}

/** Told by the window's frame: what the sidebar gives by stepping aside. */
export function setSidebarRoom(room: number): void {
  sidebarRoom = room;
}

/** A phone shows one island: a split never fits there. */
function roomFor(
  root: LayoutNode,
  keep: ReadonlySet<string> = new Set(),
): RoomCheck {
  if (root.kind === "split" && isPhoneLayout())
    return { short: Infinity, panels: 0 };
  return check ? check(root, keep) : { short: 0, panels: 0 };
}

/** Whether a layout's islands, each at its least, fit the area as it is. */
export function layoutFits(root: LayoutNode): boolean {
  return roomFor(root).short <= 0.5;
}

/** The pixels `root` lacks once the panels' islands but those in `keep`
 *  (what it makes) fold and the sidebar steps aside: 0 when it fits so. A
 *  split asked for is made then, and they give way (useNarrowIslands,
 *  useNarrowSidebar). */
export function shortGivingWay(
  root: LayoutNode,
  keep: ReadonlySet<string>,
): number {
  return refusal(root, keep).short;
}

/** Why a layout has no room: too narrow, or too low (a split upon a split
 *  that leaves an island under its least height). False: it has room. */
export type NoRoom = false | "narrow" | "low";

/** shortGivingWay, and why it is short: what the window says (sayNoRoom). */
export function refusal(
  root: LayoutNode,
  keep: ReadonlySet<string>,
): { short: number; noRoom: NoRoom } {
  const { short, panels, low } = roomFor(root, keep);
  const lacks = Math.max(0, Math.ceil(short - panels - sidebarRoom - 0.5));
  return { short: lacks, noRoom: lacks ? (low ? "low" : "narrow") : false };
}

/** A layout set into too little room: the panels, then the sidebar, give
 *  way until it fits, rather than the islands waiting for the window. */
export function askGiveWay(made: ReadonlySet<string>): void {
  givingWay = "panels";
  kept = made;
}

/** The islands not to fold while the panels give way. */
export function keptFromFolding(): ReadonlySet<string> {
  return givingWay ? kept : new Set();
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
