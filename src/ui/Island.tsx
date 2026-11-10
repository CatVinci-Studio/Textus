import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from "react";
import "./island.css";

/** What an island holds: documents (files, plugin views, web pages) or a
 *  Textus AI conversation. */
export type IslandKind = "documents" | "ai";

interface IslandPlace {
  kind: IslandKind;
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
  kind,
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
  return (
    <div
      className="island-row"
      data-island-row={kind}
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
  kind,
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
  return (
    <section
      {...rest}
      ref={sheetRef}
      className={className ? `island ${className}` : "island"}
      data-island={kind}
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
          kind={sheet.kind}
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
