import {
  useMemo,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  panesOf,
  type LayoutNode,
  type Pane,
  type SplitDirection,
} from "./tree";
import { isSplit, type SplitLayout } from "./ops";
import { islandKeys } from "./island-keys";
import { IslandNumbers } from "./IslandNumbers";
import { SplitDivider } from "./SplitDivider";
import type { Strings } from "../../i18n/strings";
import { rectStyle, type Rect } from "../frame/rect";
import {
  leastHeight,
  leastWidth,
  solveIslands,
  type IslandsLayout,
} from "../frame/solve";
import { dividerKey, type PlacedIsland } from "../frame/island-parts";
import { useIslandRoom, type IslandRoom } from "../frame/useIslandRoom";
import { usePanelWidth } from "../frame/panel-width";
import { islandRule } from "../frame/island-rules";
import { onZoom, zoomOf, zoomVersion } from "../zoom/tab-zoom";
import {
  contentMinOf,
  contentMinVersion,
  onContentMin,
} from "../frame/content-min";
import { useIslandFrame } from "../frame/useIslandFrame";
import "./split-panes.css";

/** Where one island goes in the area, in pixels. */
export interface IslandPlace {
  paneId: string;
  /** Its row of tabs, and its sheet under it. */
  row?: CSSProperties;
  sheet?: CSSProperties;
  /** Its row and its sheet together: the sheet of an island that shows no
   *  row reaches up into it. */
  whole?: CSSProperties;
  /** Its row is under another island's, not in the window bar's. */
  inner: boolean;
  /** No floating sheets: a clean sheet's, Zen's (Island's plain). */
  plain: boolean;
  /** Its key in the window's frame: its parts' data-frame. */
  frame: string;
}

/** The islands' content: given where each goes and the key each is drawn
 *  under, draws them all. */
export type IslandContent = (
  places: { pane: Pane; place: IslandPlace; key: string }[],
) => ReactNode;

/**
 * The islands' area (design-language.md 5.7): the layout solved in pixels
 * (frame/solve.ts), each island placed there and moved by the window's one
 * clock (useIslandFrame), the dividers in the gaps between them. It knows
 * no tab's content: `content` draws it at the places it is given.
 */
export function IslandArea({
  layout,
  rows,
  plain,
  isPanel,
  content,
  t,
}: {
  /** The window's islands, one when unsplit. */
  layout: SplitLayout;
  /** The islands show rows of tabs. */
  rows: boolean;
  plain: boolean;
  /** A panel's island (the AI, Settings): it keeps its width. */
  isPanel: (pane: Pane) => boolean;
  content: IslandContent;
  t: Strings;
}) {
  const ref = useRef<HTMLElement>(null);
  const keyed = useRef(new Map<string, string>());
  const panel = usePanelWidth();
  // Solved again as an island's content measures a new least width.
  useSyncExternalStore(onContentMin, contentMinVersion);
  // And as a document's zoom changes its column's least.
  useSyncExternalStore(onZoom, zoomVersion);
  const split = isSplit(layout);
  const room = useIslandRoom(ref, `${split} ${rows} ${plain}`);
  const all = panesOf(layout.root);
  const { keys, byTab } = islandKeys(all, keyed.current);
  keyed.current = byTab;
  const area = room && boxOf(room, rows);
  const solved =
    room && area && solve(room, area, layout, rows, panel, isPanel);
  const places = all.map((pane, i) => {
    const rects = solved?.islands.get(pane.id);
    return {
      pane,
      key: keys[i],
      place: {
        paneId: pane.id,
        row: rects?.row ? rectStyle(rects.row) : undefined,
        sheet: rects && rectStyle(rects.sheet),
        whole: rects && rectStyle(rects.whole),
        inner: rects?.inner ?? false,
        plain,
        frame: keys[i],
      },
    };
  });
  const placed: PlacedIsland[] = places.flatMap(({ pane, key }) => {
    const rects = solved?.islands.get(pane.id);
    return rects
      ? [{ key, paneId: pane.id, rects, tabs: pane.tabs, front: pane.front }]
      : [];
  });
  // Drawn again when an island comes, goes or changes its tabs - not as
  // they only move or resize: the window's clock places them (useIslandFrame).
  const shape = places
    .map(
      ({ pane, key, place }) =>
        `${key}:${pane.id}:${pane.front ?? ""}:${pane.tabs.join(",")}:${place.inner}:${place.plain}:${!!place.sheet}`,
    )
    .join(" ");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- by shape alone
  const drawn = useMemo(() => content(places), [content, shape]);
  // What the docks beside the area leave room for (useNarrowSidebar).
  const need =
    room &&
    leastWidth({
      root: layout.root,
      gap: room.gap,
      rowHeight: 0,
      rule: ruleFor(panel, isPanel),
    }) +
      2 * room.inset;
  // A layout fits when its islands at their least do: a split that
  // doesn't is not made (store.ts).
  const fits = (root: LayoutNode) => {
    if (!room || !area) return true;
    const input = {
      root,
      gap: room.gap,
      rowHeight: 0,
      rule: ruleFor(panel, isPanel),
    };
    return (
      leastWidth(input) <= area.w + 0.5 &&
      leastHeight(input) + (rows ? room.bar : 0) <= area.h + 0.5
    );
  };
  useIslandFrame(ref, room, area, solved, placed, need || 0, fits);
  return (
    <main
      ref={ref}
      className={split ? "main-pane main-pane-split" : "main-pane"}
      data-split={split ? layout.root.direction : undefined}
    >
      {drawn}
      <IslandNumbers />
      {solved?.dividers.map(({ line, rect, before, after, fixed }) => (
        <SplitDivider
          key={dividerKey(line.path, line.index)}
          frame={dividerKey(line.path, line.index)}
          layout={layout}
          line={line}
          style={rectStyle(rect)}
          // Up through the window bar's row only from the islands' top:
          // one lower down stops at the island above.
          reach={!!area && rect.y <= area.y + 0.5}
          sides={{ before, after }}
          fixed={fixed}
          t={t}
        />
      ))}
    </main>
  );
}

/** The islands' box in the area: inset from its sides and foot; without
 *  rows, under the window bar. */
function boxOf(room: IslandRoom, rows: boolean): Rect {
  // With no row of tabs the sheet clears what of the window bar lies over
  // the area: all of it, or none when the bar is a row of its own.
  const top = rows ? 0 : Math.max(room.inset, room.bar - room.origin.y);
  return {
    x: room.inset,
    y: top,
    w: Math.max(0, room.w - 2 * room.inset),
    h: Math.max(0, room.h - top - room.inset),
  };
}

function solve(
  room: IslandRoom,
  box: Rect,
  layout: SplitLayout,
  rows: boolean,
  panel: number,
  isPanel: (pane: Pane) => boolean,
): IslandsLayout {
  return solveIslands({
    root: layout.root,
    box,
    gap: room.gap,
    rowHeight: rows ? room.bar : 0,
    rule: ruleFor(panel, isPanel),
  });
}

/** Each island's rule: a panel's or a document's, raised to its front
 *  tab's measured least and its document's zoom. */
function ruleFor(panel: number, isPanel: (pane: Pane) => boolean) {
  return (pane: Pane, direction: SplitDirection) =>
    islandRule(
      isPanel(pane),
      direction,
      panel,
      contentMinOf(pane.front),
      zoomOf(pane.front),
    );
}
