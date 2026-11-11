import { tabInUse } from "../../engine/layout/store";
import { dragGhost } from "../../engine/drag/ghost";
import { dropIntent } from "../../engine/drag/drop-intent";
import { scaledPx } from "../../engine/tokens/chrome-scale";
import {
  barDropAt,
  dropGeometry,
  tabRectOf,
  dropTargetAt,
  type DropTarget,
} from "../../engine/layout/drop-zones";
import {
  joined,
  lifted,
  movePane,
  moveTab,
  oneIsland,
  reorderTab,
  type SplitLayout,
} from "../../engine/layout/ops";
import { paneOf, previewSplit, splitLayout } from "../../engine/layout/store";
import { paneById } from "../../engine/layout/tree";
import { frameLayout } from "../../engine/frame/frame-store";
import { setDragging } from "../../engine/controls/document-drop";
import { commitDrop, dropLayout, roomMarks } from "./split-drop";
import { liftIsland, type IslandLift } from "./island-lift";
import "./split-drop.css";

/** How far the tab travels before its place closes behind it (interface
 *  px): a short pull and back leaves the layout untouched. */
const LEAVE_DISTANCE = 48;

/** A place a drop can go: its key, whether it opens a new island, the
 *  layout it makes, and the layout shown while it is only aimed at. */
interface Place {
  key: string;
  opens: boolean;
  next: SplitLayout | null | undefined;
  shown: SplitLayout | null;
  target?: DropTarget;
}

/**
 * A tab pulled out of its row (design-language.md, drag): it gathers into a
 * pill at the pointer; its place stays until it has travelled a little,
 * then closes; the islands make room where it is aimed (dropIntent), the
 * room a dashed outline; let go, it lands there and opens out. Out of the
 * window it tears off where possible; Escape puts it back. With Alt held -
 * or for the AI's tabs, `island` - the whole island goes instead, following
 * the hand at its size.
 */
export function pullTab(
  tabId: string,
  title: string,
  opts: {
    tabIds: readonly string[];
    activate: (id: string) => void;
    detach?: (id: string) => void;
    /** Let go outside the window, where `detach` can't follow the pointer. */
    releaseOutside?: (id: string) => void;
    /** The island this tab moves whole (the AI's, whose tabs stay in it). */
    island?: string;
  },
): void {
  const ghost = dragGhost(title, "tab-pull-ghost");
  const from = tabRectOf(paneOf(splitLayout(), tabId), tabId);
  if (from) ghost.gather(from);
  setDragging(true);
  // The layout the drag began over: tested against, and the base of every
  // preview (one island, spelt out, for a window not split).
  const geometry = dropGeometry();
  const base: SplitLayout =
    splitLayout() ?? oneIsland(opts.tabIds, tabInUse() || null);
  const marks = placeMarks(tabId);
  const intent = dropIntent();
  let start: { x: number; y: number } | null = null;
  let left = false;
  let lift: { id: string; piece: IslandLift } | null = null;
  let timer = 0;
  let last = { x: 0, y: 0, alt: false };

  const wholeIsland = (alt: boolean) =>
    opts.island ?? (alt ? paneOf(splitLayout(), tabId) : null);

  /** The place under (x, y). */
  const placeAt = (x: number, y: number, alt: boolean): Place | null => {
    const whole = wholeIsland(alt);
    // A tab: an island's outer tenth opens one beside it, the rest joins
    // it. A whole island can't join: it goes to the half it is over.
    const target = dropTargetAt(x, y, geometry, !!whole, current?.target);
    if (whole) {
      if (!target || target.zone === "center") return null;
      const beside = target.whole ? null : paneOf(base, target.tabId);
      if (beside === whole) return null;
      const next = movePane(base, whole, beside, target.zone);
      return {
        key: `island:${beside ?? "whole"}:${target.zone}`,
        opens: true,
        next,
        shown: next,
      };
    }
    const bar = barDropAt(x, y, tabId, geometry);
    if (bar) {
      const moved = moveTab(base, tabId, bar.pane, bar.index);
      const next = moved && reorderTab(moved, bar.pane, tabId, bar.index);
      return {
        key: `bar:${bar.pane}:${bar.index}`,
        opens: false,
        next,
        // Its slot in that row, the row's own document still in front.
        shown: joined(base, tabId, bar.pane, bar.index),
      };
    }
    if (!target) return null;
    const next = dropLayout(splitLayout(), tabId, target, opts.tabIds);
    if (next === undefined) return null;
    const pane = target.zone === "center" ? paneOf(base, target.tabId) : null;
    // Its own island's middle: where it came from.
    if (pane && pane === paneOf(base, tabId)) return null;
    const end = pane ? (paneById(base.root, pane)?.tabs.length ?? 0) : 0;
    return {
      key: `${target.whole ? "whole" : target.tabId}:${target.zone}`,
      opens: target.zone !== "center",
      next,
      // Joining: its slot at the row's end, the row's document in front.
      shown: pane ? joined(base, tabId, pane, end) : next,
      target,
    };
  };

  /** What the islands show: as they were, the tab's place closed, or the
   *  room where it is aimed. */
  let closed: SplitLayout | null = null;
  const show = (place: Place | null) => {
    if (place) previewSplit(place.shown);
    // One layout for "its place closed", made once: a new one each move
    // redrew every island each move, and the bottom flickered.
    else if (left && !wholeIsland(last.alt))
      previewSplit((closed ??= lifted(base, tabId)));
    else previewSplit(null);
    marks.update(left, place?.shown ?? null, !!wholeIsland(last.alt));
  };

  const follow = (x: number, y: number, alt: boolean) => {
    const id = wholeIsland(alt);
    if (lift && lift.id !== id) {
      lift.piece.remove();
      lift = null;
    }
    if (id && !lift) lift = { id, piece: liftIsland(id, x, y) };
    ghost.hide(!!lift);
    if (lift) lift.piece.move(x, y);
    else ghost.move(x, y);
  };

  /** The place taken: the one under the pointer once it has rested
   *  there (dropIntent), else the one before. */
  let current: Place | null = null;
  const aim = () => {
    const { x, y, alt } = last;
    // Over the room it opened, the place holds: the islands moved under a
    // pointer tested against where they were, and a drop there went astray.
    const room = current && !wholeIsland(alt) ? marks.island() : null;
    if (
      room &&
      x >= room.left &&
      x <= room.right &&
      y >= room.top &&
      y <= room.bottom
    )
      return;
    // Nothing is aimed at until the tab has left its place.
    const place = left || wholeIsland(alt) ? placeAt(x, y, alt) : null;
    const { shown, again } = intent.settle(
      place?.key ?? null,
      place?.opens ?? false,
      x,
      y,
    );
    window.clearTimeout(timer);
    if (again !== undefined) timer = window.setTimeout(aim, again);
    // The same place keeps the layout it was given: a fresh one per move
    // would redraw the islands on every move.
    if (shown === (place?.key ?? null) && place?.key !== current?.key)
      current = place;
    show(current);
  };

  const outside = (e: PointerEvent) =>
    e.clientX < 0 ||
    e.clientY < 0 ||
    e.clientX > window.innerWidth ||
    e.clientY > window.innerHeight;

  const move = (e: PointerEvent) => {
    // Let go where no pointerup reached the page (WebView2 can lose it).
    if (e.buttons === 0) {
      up(e);
      return;
    }
    if (opts.detach && !wholeIsland(e.altKey) && outside(e)) {
      stop();
      opts.detach(tabId);
      return;
    }
    start ??= { x: e.clientX, y: e.clientY };
    if (
      !left &&
      Math.hypot(e.clientX - start.x, e.clientY - start.y) >
        scaledPx(LEAVE_DISTANCE)
    )
      left = true;
    last = { x: e.clientX, y: e.clientY, alt: e.altKey };
    follow(e.clientX, e.clientY, e.altKey);
    aim();
  };

  const up = (e: PointerEvent) => {
    if (opts.releaseOutside && outside(e)) {
      stop();
      opts.releaseOutside(tabId);
      return;
    }
    const place = current;
    if (place && place.next !== undefined) {
      opts.activate(tabId);
      // The layout it showed, made: the same panes, so nothing jumps;
      // the pill lands where its room was.
      commitDrop(place.next);
      const room = marks.room();
      if (room && !lift) {
        ghost.land(room);
        stop(true);
        return;
      }
    }
    stop();
  };

  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") stop();
  };

  function stop(landing = false) {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key, true);
    window.clearTimeout(timer);
    if (!landing) ghost.remove();
    lift?.piece.remove();
    marks.remove();
    setDragging(false);
    previewSplit(null);
  }
  const cancel = () => stop();
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key, true);
}

/**
 * The looks a pulled tab gives the islands, in one style element: its own
 * pill faded while its place stays; its document out of sight once it has
 * left; where it is aimed, an outline - its slot in a row, or a whole
 * island still empty.
 */
function placeMarks(tabId: string) {
  const style = document.createElement("style");
  document.head.append(style);
  const tab = CSS.escape(tabId);
  /** The row whose slot it would take (a pane). */
  let roomRow: string | undefined;
  let roomPane: string | null = null;
  return {
    update(left: boolean, shown: SplitLayout | null, whole: boolean) {
      const rules: string[] = [];
      if (!left && !shown && !whole)
        rules.push(`.tab-pill[data-tab="${tab}"] { opacity: 0.4; }`);
      // A whole island on the move: its word count goes with it.
      if (whole)
        rules.push(
          `.document-corner[data-corner-of="${tab}"] { visibility: hidden; }`,
        );
      roomRow = undefined;
      roomPane = null;
      if (!whole && (left || shown)) {
        rules.push(`[data-tab-id="${tab}"] { visibility: hidden; }`);
        const marks = roomMarks(shown, tabId);
        rules.push(...marks.rules);
        roomPane = marks.room;
        roomRow = marks.row;
      }
      // Rewritten only when it changes: each rewrite restyles the page.
      const text = rules.join("\n");
      if (style.textContent !== text) style.textContent = text;
    },
    /** Where the tab lands: its slot in a row, or the new island's room,
     *  where the solver puts it. */
    room(): DOMRect | null {
      const at = roomPane && islandAt(roomPane);
      if (at) return at;
      return roomRow === undefined ? null : tabRectOf(roomRow, tabId);
    },
    /** The new island's room: the place holds while the pointer is on it,
     *  and lets go once it leaves, the islands coming back. */
    island(): DOMRect | null {
      return roomPane ? islandAt(roomPane) : null;
    },
    remove() {
      style.remove();
    },
  };
}

/** Pane `id`'s sheet, as the solver last placed it. */
function islandAt(id: string): DOMRect | null {
  const at = frameLayout().islands.find((island) => island.paneId === id);
  return at
    ? new DOMRect(at.sheet.x, at.sheet.y, at.sheet.w, at.sheet.h)
    : null;
}
