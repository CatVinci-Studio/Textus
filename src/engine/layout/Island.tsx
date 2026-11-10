import {
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { useRowInsets } from "./row-insets";
import { rowKey, sheetKey } from "../frame/island-parts";
import "./island.css";

interface IslandPlace {
  /** The interface's paper, not a page's, and a target itself: an island
   *  that is one panel (the chat window's). */
  ui?: boolean;
  /** Its pane in the window's layout; ties its row to its sheet. */
  paneId?: string;
  /** Plain: a clean sheet's or Zen's - no floating sheet, the page's own
   *  paper, its tabs words. */
  plain?: boolean;
  /** Its key in the window's frame (frame/island-parts.ts). */
  frame?: string;
}

/**
 * An island's row of tabs (island.css): as tall as the window bar, its
 * tabs standing on its sheet's top edge between --tabs-inset-start and
 * --tabs-inset-end (row-insets.ts). `inner`: under another island, not in the
 * window bar's row, so it has no bar controls to clear.
 */
export function IslandRow({
  ui,
  paneId,
  plain,
  frame,
  inner,
  style,
  children,
}: IslandPlace & {
  inner?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const insets = useRowInsets(frame);
  return (
    <div
      className="island-row"
      data-at-corner={insets?.atCorner || undefined}
      data-frame={frame && rowKey(frame)}
      data-island-row={ui ? "ui" : "documents"}
      data-pane-id={paneId}
      data-inner={inner || undefined}
      data-plain={plain || undefined}
      style={
        insets
          ? ({
              ...style,
              "--tabs-inset-start": `${insets.start}px`,
              "--tabs-inset-end": `${insets.end}px`,
            } as CSSProperties)
          : style
      }
    >
      {children}
    </div>
  );
}

/**
 * An island's sheet (island.css): the rounded, floating paper - or the
 * flush classic one - its row's open tab rising from its top edge. A
 * documents island's sheet is only paper: each tab's editor lies over it
 * in the same cell, as editors stay mounted where they are wherever their
 * pane goes.
 */
export function IslandSheet({
  ui,
  paneId,
  plain,
  frame,
  sheetRef,
  className,
  children,
  ...rest
}: IslandPlace &
  HTMLAttributes<HTMLElement> & {
    sheetRef?: Ref<HTMLElement>;
    children?: ReactNode;
  }) {
  // Its first tab at its edge and open: the corner joins it, square.
  const joined = useRowInsets(frame)?.joined;
  return (
    <section
      {...rest}
      data-frame={frame && sheetKey(frame)}
      ref={sheetRef}
      className={className ? `island ${className}` : "island"}
      data-island={ui ? "ui" : "documents"}
      data-pane-id={paneId}
      data-plain={plain || undefined}
      data-corner-joined={joined || undefined}
      aria-hidden={children ? rest["aria-hidden"] : true}
    >
      {children}
    </section>
  );
}

/**
 * One island: its row of tabs over its sheet, each where the area places
 * it (`row`, `sheet` styles) - or, with no row, the sheet alone.
 */
export function Island({
  row,
  rowStyle,
  inner,
  sheetStyle,
  ...sheet
}: IslandPlace &
  Omit<HTMLAttributes<HTMLElement>, "style"> & {
    row?: ReactNode;
    rowStyle?: CSSProperties;
    inner?: boolean;
    sheetStyle?: CSSProperties;
    sheetRef?: Ref<HTMLElement>;
    children?: ReactNode;
  }) {
  return (
    <>
      {row !== undefined && (
        <IslandRow
          ui={sheet.ui}
          paneId={sheet.paneId}
          plain={sheet.plain}
          frame={sheet.frame}
          inner={inner}
          style={rowStyle}
        >
          {row}
        </IslandRow>
      )}
      <IslandSheet {...sheet} style={sheetStyle} />
    </>
  );
}
