import type { CSSProperties } from "react";

/**
 * An island's frame (layout.css): the rounded sheet, or the flush classic
 * one, under a pane's documents - its row of tabs over its top edge. A
 * frame of its own rather than the documents' box, since each tab's editor
 * stays a child of the main pane wherever its pane sits. `paneId` ties it
 * to its pane's row (useTabRows squares its corner under a flush tab); a
 * split places it on its pane's cell.
 */
export function IslandFrame({
  paneId,
  style,
}: {
  paneId: string | null;
  style?: CSSProperties;
}) {
  return (
    <div
      className="island-frame"
      data-island=""
      data-pane-id={paneId ?? undefined}
      style={style}
      aria-hidden="true"
    />
  );
}
