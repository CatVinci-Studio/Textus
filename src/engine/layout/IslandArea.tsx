import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { nodeAt, panesOf, type Pane } from "./tree";
import type { SplitLayout } from "./ops";
import { islandKeys } from "./island-keys";
import { IslandNumbers } from "./IslandNumbers";
import { SplitDivider } from "./SplitDivider";
import type { Strings } from "../../i18n/strings";
import { rectStyle, type Rect } from "../frame/rect";
import { leastWidth, solveIslands, type IslandsLayout } from "../frame/solve";
import { setIslandsNeed } from "../frame/islands-need";
import { dividerKey, type PlacedIsland } from "../frame/island-parts";
import { useIslandRoom, type IslandRoom } from "../frame/useIslandRoom";
import { usePanelWidth } from "../frame/panel-width";
import { islandRule } from "../frame/island-rules";
import { useIslandFrame } from "../frame/useIslandFrame";
import "./split-panes.css";

/** Where one island goes in the area, in pixels. */
export interface IslandPlace {
  /** Its pane; none when the area is one island, unsplit. */
  paneId?: string;
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

/** The islands' content: given where each goes (one place, unsplit, with
 *  no layout) and the key each is drawn under, draws them all. */
export type IslandContent = (
  places: { pane: Pane | null; place: IslandPlace; key: string }[],
) => ReactNode;

/**
 * The islands' area (design-language.md 5.7): the layout solved in pixels
 * (frame/solve.ts), each island placed there and moved by the window's one
 * clock (useIslandFrame), the dividers in the gaps between them. It knows
 * no tab's content: `content` draws it at the places it is given.
 */
export function IslandArea({
  layout,
  tabs,
  front,
  rows,
  plain,
  isPanel,
  content,
  t,
}: {
  /** The window's layout; null: one island filling it. */
  layout: SplitLayout | null;
  /** The window's tabs, for the one island unsplit. */
  tabs: readonly string[];
  /** The tab in front of the one island, unsplit. */
  front: string | null;
  /** The islands show rows of tabs. */
  rows: boolean;
  plain: boolean;
  /** A panel's island (the AI, Settings): it keeps its width. */
  isPanel: (pane: Pane) => boolean;
  content: IslandContent;
  t: Strings;
}) {
  const ref = useRef<HTMLElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const keyed = useRef(new Map<string, string>());
  const panel = usePanelWidth();
  const room = useIslandRoom(ref, probe, `${!!layout} ${rows} ${plain}`);
  const all = layout ? panesOf(layout.root) : [];
  const { keys, byTab } = islandKeys(
    layout ? all : [{ id: "window", tabs }],
    keyed.current,
  );
  keyed.current = byTab;
  const area = room && boxOf(room, rows);
  const solved =
    room && area && solve(room, area, layout, keys[0], rows, panel, isPanel);
  const box = (key: string) => solved?.islands.get(key);
  const places = (layout ? all : [null]).map((pane, i) => {
    const rects = box(pane ? pane.id : keys[0]);
    return {
      pane,
      key: keys[i],
      place: {
        paneId: pane?.id,
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
    const rects = box(pane ? pane.id : keys[0]);
    return rects
      ? [
          {
            key,
            paneId: pane?.id ?? null,
            rects,
            tabs: pane ? pane.tabs : tabs,
            front: pane ? pane.front : front,
          },
        ]
      : [];
  });
  useIslandFrame(ref, room, area, solved, placed);
  // Drawn again when an island comes, goes or changes its tabs - not as
  // they only move or resize: the window's clock places them (useIslandFrame).
  const shape = places
    .map(
      ({ pane, key, place }) =>
        `${key}:${pane?.id ?? ""}:${pane?.front ?? ""}:${pane?.tabs.join(",") ?? ""}:${place.inner}:${place.plain}:${!!place.sheet}`,
    )
    .join(" ");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- by shape alone
  const drawn = useMemo(() => content(places), [content, shape]);
  // What the docks beside the area leave room for (useNarrowSidebar).
  const need =
    room &&
    leastWidth({
      root: layout?.root ?? {
        kind: "pane",
        id: keys[0],
        tabs: [...tabs],
        front,
      },
      gap: room.gap,
      rowHeight: 0,
      rule: (pane, direction) => islandRule(isPanel(pane), direction, panel),
    }) +
      2 * room.inset;
  useEffect(() => {
    if (need) setIslandsNeed(need);
  }, [need]);
  return (
    <main
      ref={ref}
      className={layout ? "main-pane main-pane-split" : "main-pane"}
      data-split={layout?.root.direction}
    >
      <div ref={probe} className="frame-probe" aria-hidden="true" />
      {drawn}
      <IslandNumbers />
      {layout &&
        solved?.dividers.map(({ line, rect, before, after }) => (
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
            fixed={fixedSide(layout, line.path, line.index, isPanel)}
            t={t}
          />
        ))}
    </main>
  );
}

/** The islands' box in the area: inset from its sides and foot; without
 *  rows, under the window bar. */
function boxOf(room: IslandRoom, rows: boolean): Rect {
  const top = rows ? 0 : room.bar;
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
  layout: SplitLayout | null,
  single: string,
  rows: boolean,
  panel: number,
  isPanel: (pane: Pane) => boolean,
): IslandsLayout {
  return solveIslands({
    root: layout?.root ?? null,
    single,
    box,
    gap: room.gap,
    rowHeight: rows ? room.bar : 0,
    rule: (pane, direction) => islandRule(isPanel(pane), direction, panel),
  });
}

/** Which side of a divider is a panel's island, keeping its width. */
function fixedSide(
  layout: SplitLayout,
  path: number[],
  index: number,
  isPanel: (pane: Pane) => boolean,
): "before" | "after" | null {
  const side = (i: number) => {
    const node = nodeAt(layout.root, [...path, i]);
    return node?.kind === "pane" && isPanel(node);
  };
  const before = side(index);
  const after = side(index + 1);
  return before === after ? null : before ? "before" : "after";
}
