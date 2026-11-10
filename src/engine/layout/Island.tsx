import {
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import "./island.css";

/** Whether the window's first islands are up: one made after that is new,
 *  and plays its entrance; the first ones simply are. */
let ready = false;

/** Called once the window's first layout is on screen. */
export function markIslandsReady(): void {
  ready = true;
}

/** True for an island made after the window's first layout. */
function useFresh(): boolean {
  return useState(() => ready)[0];
}

interface IslandPlace {
  /** The interface's paper, not a page's, and a target itself: an island
   *  that is one panel (the chat window's). */
  ui?: boolean;
  /** Its pane in the window's layout; ties its row to its sheet. */
  paneId?: string;
  /** Plain: a clean sheet's or Zen's - no floating sheet, the page's own
   *  paper, its tabs words. */
  plain?: boolean;
}

/**
 * An island's row of tabs (island.css): as tall as the window bar, its
 * tabs standing on its sheet's top edge between --tabs-inset-start and
 * --tabs-inset-end (useTabRows). `inner`: under another island, not in the
 * window bar's row, so it has no bar controls to clear.
 */
export function IslandRow({
  ui,
  paneId,
  plain,
  inner,
  style,
  children,
}: IslandPlace & {
  inner?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const fresh = useFresh();
  return (
    <div
      className="island-row"
      data-fresh={fresh || undefined}
      data-island-row={ui ? "ui" : "documents"}
      data-pane-id={paneId}
      data-inner={inner || undefined}
      data-plain={plain || undefined}
      style={style}
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
  sheetRef,
  className,
  children,
  ...rest
}: IslandPlace &
  HTMLAttributes<HTMLElement> & {
    sheetRef?: Ref<HTMLElement>;
    children?: ReactNode;
  }) {
  const fresh = useFresh();
  return (
    <section
      {...rest}
      data-fresh={fresh || undefined}
      ref={sheetRef}
      className={className ? `island ${className}` : "island"}
      data-island={ui ? "ui" : "documents"}
      data-pane-id={paneId}
      data-plain={plain || undefined}
      aria-hidden={children ? rest["aria-hidden"] : true}
    >
      {children}
    </section>
  );
}

/**
 * One island: its row of tabs over its sheet, each in its own cell of the
 * area's grid (`row`, `sheet` styles) - or, with no row, the sheet alone.
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
