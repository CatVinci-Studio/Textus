import { useRef, type CSSProperties, type ReactNode } from "react";
import { panesOf, splitGrid, type Pane, type SplitGrid } from "./tree";
import type { SplitLayout } from "./ops";
import { islandKeys } from "./island-keys";
import { IslandMotion } from "./IslandMotion";
import { SplitDivider } from "./SplitDivider";
import { useTabRows } from "./useTabRows";
import type { Strings } from "../../i18n/strings";
import "./split-panes.css";

/** Where one island goes in the area's grid. */
export interface IslandPlace {
  /** Its pane; none when the area is one island, unsplit. */
  paneId?: string;
  /** Its row of tabs' cell, and its sheet's under it. */
  row?: CSSProperties;
  sheet?: CSSProperties;
  /** Its row and its sheet together: the sheet of an island that shows no
   *  row reaches up into it. */
  whole?: CSSProperties;
  /** Its row is under another island's, not in the window bar's. */
  inner: boolean;
  /** No floating sheets: a clean sheet's, Zen's (Island's plain). */
  plain: boolean;
}

/** The islands' content: given where each goes (one place, unsplit, with
 *  no layout) and the key each is drawn under, draws them all. */
export type IslandContent = (
  places: { pane: Pane | null; place: IslandPlace; key: string }[],
) => ReactNode;

/**
 * The islands' area (design-language.md 5.7): the window's layout drawn as
 * one grid, each island where the tree puts it, the dividers between them
 * and every move a slide. It knows no tab's content: `content` draws it at
 * the places it is given.
 */
export function IslandArea({
  layout,
  tabs,
  plain,
  content,
  t,
}: {
  /** The window's layout; null: one island filling it. */
  layout: SplitLayout | null;
  /** The window's tabs, for the one island unsplit. */
  tabs: readonly string[];
  plain: boolean;
  content: IslandContent;
  t: Strings;
}) {
  const ref = useRef<HTMLElement>(null);
  const keyed = useRef(new Map<string, string>());
  useTabRows(ref);
  const grid = layout && splitGrid(layout.root);
  const all = layout ? panesOf(layout.root) : [];
  const { keys, byTab } = islandKeys(
    grid ? all : [{ id: "window", tabs }],
    keyed.current,
  );
  keyed.current = byTab;
  const places = grid
    ? all.map((pane, i) => ({
        pane,
        place: placeOf(grid, pane.id, plain),
        key: keys[i]!,
      }))
    : [{ pane: null, place: { inner: false, plain }, key: keys[0]! }];
  return (
    <main
      ref={ref}
      className={layout ? "main-pane main-pane-split" : "main-pane"}
      data-split={layout?.root.direction}
      style={grid?.column}
    >
      <IslandMotion
        layout={`${grid?.column.gridTemplateColumns} ${grid?.column.gridTemplateRows} ${all.map((p) => p.id)}`}
        area={ref}
      />
      {content(places)}
      {layout &&
        grid?.dividers.map(({ line, style }) => (
          <SplitDivider
            key={`${line.path.join(".")}:${line.index}`}
            layout={layout}
            line={line}
            style={style}
            t={t}
          />
        ))}
    </main>
  );
}

function placeOf(grid: SplitGrid, id: string, plain: boolean): IslandPlace {
  const sheet = grid.bodies.get(id);
  const row = grid.bars.get(id);
  const top = String(row?.gridRow ?? "").split(" / ")[0];
  const end = String(sheet?.gridRow ?? "").split(" / ")[1];
  return {
    paneId: id,
    row,
    sheet,
    whole:
      sheet && top && end ? { ...sheet, gridRow: `${top} / ${end}` } : sheet,
    inner: !grid.top.has(id),
    plain,
  };
}
