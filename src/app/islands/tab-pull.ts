import { dragGhost } from "../../engine/drag/ghost";
import { dropIntent } from "../../engine/drag/drop-intent";
import { scaledPx } from "../../engine/tokens/chrome-scale";
import {
  barDropAt,
  dropGeometry,
  dropTargetAt,
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
import { paneWithTab } from "../../engine/layout/tree";
import { setDragging } from "../../engine/controls/document-drop";
import { commitDrop, dropLayout } from "./split-drop";
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
  const pill = document.querySelector<HTMLElement>(
    `.tab-pill[data-flip-id="${CSS.escape(tabId)}"]`,
  );
  const ghost = dragGhost(title, "tab-pull-ghost");
  if (pill) ghost.gather(pill.getBoundingClientRect());
  setDragging(true);
  // The layout the drag began over: tested against, and the base of every
  // preview (one island, spelt out, for a window not split).
  const geometry = dropGeometry();
  const base: SplitLayout =
    splitLayout() ??
    oneIsland(
      opts.tabIds,
      document.querySelector<HTMLElement>('[data-active-tab="true"]')?.dataset
        .tabId ?? null,
    );
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
    const target = dropTargetAt(x, y, geometry);
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
    return {
      key: `${target.whole ? "whole" : target.tabId}:${target.zone}`,
      opens: target.zone !== "center",
      next,
      shown: next,
    };
  };

  /** What the islands show: as they were, the tab's place closed, or the
   *  room where it is aimed. */
  const show = (place: Place | null) => {
    if (place) previewSplit(place.shown);
    else if (left && !wholeIsland(last.alt)) previewSplit(lifted(base, tabId));
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
    if (shown === (place?.key ?? null)) current = place;
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
  let roomSelector: string | null = null;
  return {
    update(left: boolean, shown: SplitLayout | null, whole: boolean) {
      const rules: string[] = [];
      if (!left && !shown)
        rules.push(`.tab-pill[data-flip-id="${tab}"] { opacity: 0.4; }`);
      roomSelector = null;
      if (!whole && (left || shown)) {
        rules.push(`[data-tab-id="${tab}"] { visibility: hidden; }`);
        const pane = shown && paneWithTab(shown.root, tabId);
        if (pane && pane.tabs.length === 1) {
          const id = CSS.escape(pane.id);
          roomSelector = `section.island[data-pane-id="${id}"]`;
          rules.push(
            `${roomSelector} { background: var(--drop-room-island) center / 100% 100% no-repeat !important; box-shadow: none !important; }`,
            `.island-row[data-pane-id="${id}"] { visibility: hidden; }`,
          );
        } else if (pane) {
          roomSelector = `.tab-pill[data-flip-id="${tab}"]`;
          rules.push(
            `${roomSelector} { background: var(--drop-room-slot) center / 100% 100% no-repeat !important; box-shadow: none !important; }`,
            `${roomSelector} > * { visibility: hidden; }`,
          );
        }
      }
      style.textContent = rules.join("\n");
    },
    /** Where the room shown is, for the pill to land on. */
    room(): DOMRect | null {
      const el = roomSelector && document.querySelector(roomSelector);
      return el ? el.getBoundingClientRect() : null;
    },
    remove() {
      style.remove();
    },
  };
}
