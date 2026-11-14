import { tokenPx } from "../tokens/token-px";
import { shownIsland } from "./store";
import { onAppearance } from "../tokens/appearance";
import { useSyncExternalStore } from "react";
import { scaledPx } from "../tokens/chrome-scale";
import { setStripOrigins } from "../controls/tabs/tab-strips";
import {
  frameLayout,
  useFrameLayout,
  type FrameIsland,
} from "../frame/frame-store";

/** Air kept between the tabs and the window bar's own controls. */
const AIR = 8;
/** Bare bar kept before the window's own controls, however many tabs:
 *  somewhere to grab the window by. */
const GRIP = 62;
/** Room a row keeps for its tabs before any grip: one tab at its least
 *  (TabBar.css) and the row's + and list. */
const ROOM = 132;

/** Where one tab row in the window bar's row starts and ends its tabs. */
interface RowInsets {
  start: number;
  end: number;
  /** The first tab rises from its sheet's own edge. */
  atCorner: boolean;
}

/**
 * Each tab row sits over its sheet, the same width (layout.css).
 * Its tabs keep clear of the window bar's controls - the window's buttons
 * and the sidebar's at the bar's start, the status at its end - and of the
 * sheet's rounded corner and the tab's own curve in (`corner`). Where the
 * controls leave it room the first tab starts at the sheet's edge instead,
 * the sheet's side running straight up into it.
 */
export function rowInsets(
  row: { left: number; right: number },
  leadEnd: number,
  statusStart: number,
  air: number,
  corner: number,
  grip = 0,
  room = 0,
): RowInsets {
  // Controls wholly before the row (the menu in the rail's column) are no
  // obstacle: the first tab can stand at the sheet's edge.
  const clear = leadEnd <= row.left ? 0 : leadEnd + air - row.left;
  const atCorner = clear <= 0;
  const start = atCorner ? 0 : Math.max(clear, corner);
  const over = row.right - statusStart + air;
  const under = Math.max(corner, over);
  // The grip gives way first where the tabs would have no room.
  const free = row.right - row.left - start - under - room;
  const kept = row.right > statusStart ? Math.min(grip, Math.max(0, free)) : 0;
  return { start, end: Math.max(corner, over + kept), atCorner };
}

/** What of the window bar the rows keep clear of, in the viewport. */
interface BarObstacles {
  /** The end of its leading controls (the menu, the sidebar's toggle). */
  leadEnd: number;
  /** Where each control ending it starts (its status, the window's
   *  buttons). */
  ends: readonly number[];
  /** The bar's own sides and foot. */
  left: number;
  right: number;
  bottom: number;
  /** The sheet's corner and the tab's curve in beside it. */
  corner: number;
}

const LEAD =
  ".window-bar-sidebar-toggle, .window-menu-button, .window-bar-lead";
const ENDS = ".window-bar-status, .window-bar .window-caption";
const BAR = ".window-bar, .chat-window-header";

/** The window bar's controls, measured: they are outside the islands,
 *  placed by their own stylesheet - the rows' inputs, not their layout. */
function barSides() {
  const bar = document.querySelector(BAR);
  const box = bar?.getBoundingClientRect();
  const shift = slid(bar);
  return {
    left: (box?.left ?? 0) - shift,
    right: box ? box.right - shift : window.innerWidth,
    bottom: box?.bottom ?? 0,
  };
}

/** How far the bar is slid aside (a phone's sidebar pushing it), which
 *  the rows inside it share: left out of every measure. */
function slid(bar: Element | null | undefined): number {
  const moved = bar && getComputedStyle(bar).transform;
  return moved && moved !== "none" ? new DOMMatrix(moved).m41 : 0;
}

function measure(): BarObstacles {
  const shift = slid(document.querySelector(BAR));
  const boxes = (selector: string) =>
    [...document.querySelectorAll(selector)]
      .filter((el) => el.matches(LEAD) || el.firstElementChild)
      .map((el) => el.getBoundingClientRect())
      .filter((box) => box.width > 0);
  return {
    leadEnd: Math.max(
      -Infinity,
      ...boxes(LEAD).map((box) => box.right - shift),
    ),
    ends: boxes(ENDS).map((box) => box.left - shift),
    ...barSides(),
    corner: tokenPx("--island-radius") + tokenPx("--tab-radius"),
  };
}

let obstacles: BarObstacles | null = null;
const listeners = new Set<() => void>();
let stopWatching: (() => void) | null = null;

/** Room between the bar's leading controls and the sidebar's name. */
const TITLE_GAP = 16;

/** Where a name beside the bar's leading controls may start, as a length
 *  for stylesheets (activity-rail.css): past them by `gap`; 0 with none. */
export function leadClearLength(leadEnd: number, gap: number): string {
  return `${Number.isFinite(leadEnd) && leadEnd > 0 ? Math.ceil(leadEnd + gap) : 0}px`;
}

function remeasure() {
  const next = measure();
  if (JSON.stringify(next) === JSON.stringify(obstacles)) return;
  obstacles = next;
  document.documentElement.style.setProperty(
    "--bar-lead-clear",
    leadClearLength(next.leadEnd, scaledPx(TITLE_GAP)),
  );
  for (const listener of listeners) listener();
}

/** Measured again as the window, its bar's controls or the interface's
 *  size change - not as islands move. */
function watch(): () => void {
  let frame = 0;
  const soon = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(remeasure);
  };
  const resized = new ResizeObserver(soon);
  for (const el of document.querySelectorAll(`${LEAD}, ${ENDS}, ${BAR}`))
    resized.observe(el);
  const changed = new MutationObserver(() => {
    resized.disconnect();
    for (const el of document.querySelectorAll(`${LEAD}, ${ENDS}, ${BAR}`))
      resized.observe(el);
    soon();
  });
  // Controls come and go (a status shown, the sidebar's toggle) and the
  // interface's size and theme are set on the root.
  for (const el of document.querySelectorAll(BAR))
    changed.observe(el, { childList: true, subtree: true });
  const restyled = onAppearance(soon);
  window.addEventListener("resize", soon);
  return () => {
    cancelAnimationFrame(frame);
    resized.disconnect();
    changed.disconnect();
    restyled();
    window.removeEventListener("resize", soon);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!stopWatching) {
    stopWatching = watch();
    remeasure();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      stopWatching?.();
      stopWatching = null;
    }
  };
}

const snapshot = () => obstacles;

/** What the island at the window's top right keeps for its row: the bar's
 *  buttons over it (its status, the window's), air, and a tab's room;
 *  0 until the bar is measured. */
export function barEndRoom(): number {
  const ends = obstacles?.ends ?? [];
  if (!ends.length) return 0;
  return obstacles!.right - Math.min(...ends) + scaledPx(AIR) + scaledPx(ROOM);
}

/** The window bar's controls as last measured; null until they are. */
export function useBarObstacles(): BarObstacles | null {
  return useSyncExternalStore(subscribe, snapshot);
}

/** Where `island`'s row (none: the window's width, the chat window's)
 *  starts and ends its tabs, given the window bar's controls. */
function insetsFor(
  island: FrameIsland | null,
  bar: BarObstacles,
): RowInsets & { joined: boolean } {
  const row = island?.row ?? { x: 0, y: 0, w: window.innerWidth, h: 0 };
  // Only a row in the window bar's has its controls to clear: not one
  // under another island, nor under the menu bar's own row.
  const inBar = row.y < bar.bottom - 1;
  const left = row.x;
  const right = row.x + row.w;
  const statusStart = Math.min(...bar.ends.filter((end) => end >= left));
  const air = scaledPx(AIR);
  const insets = rowInsets(
    { left, right },
    inBar ? bar.leadEnd : -Infinity,
    inBar ? statusStart : Infinity,
    air,
    Math.max(air, bar.corner),
    scaledPx(GRIP),
    scaledPx(ROOM),
  );
  const shown = island ? shownIsland(island.paneId) : null;
  const joined = insets.atCorner && !!shown && shown.front === shown.tabs[0];
  return { ...insets, joined };
}

/**
 * Where the row of the island `frame` keys starts and ends its tabs, and
 * whether its sheet's corner joins its first tab (open there); null until
 * it is placed. A row with no island in the frame (the chat window's)
 * spans the window.
 */
export function useRowInsets(
  frame: string | undefined,
): (RowInsets & { joined: boolean }) | null {
  const bar = useBarObstacles();
  const { islands } = useFrameLayout();
  if (!bar) return null;
  const island = frame ? islands.find((i) => i.key === frame) : null;
  if (frame && !island?.row) return null;
  return insetsFor(island ?? null, bar);
}

/** Where the tabs of pane `paneId`'s row (null: a row of no island)
 *  start, in the viewport, unscrolled; null while it has no row. */
export function tabsStartOf(paneId: string | null): number | null {
  const island = frameLayout().islands.find((i) => i.paneId === paneId);
  if (!island?.row) return null;
  return island.row.x + (obstacles ? insetsFor(island, obstacles).start : 0);
}

setStripOrigins(tabsStartOf);
