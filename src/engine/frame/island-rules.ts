import type { SplitDirection } from "../layout/tree";
import { scaledPx } from "../tokens/chrome-scale";
import { tokenPx } from "../tokens/token-px";
import type { SizeRule } from "./distribute";

/** The least an island keeps: a document's column of text (at the
 *  document's least type size, DOC_FONT), a panel's settings rows;
 *  stacked, room for a few lines. */
export const DOC_MIN = 360;
const DOC_FONT = 16.5;

/** A document's column at its own type size and zoom: the text it is
 *  read in, not the interface's, sets how narrow it may go. */
export function docMin(zoom = 1): number {
  const font = tokenPx("--doc-font-size") || DOC_FONT;
  return Math.round((DOC_MIN * font * zoom) / DOC_FONT);
}
const PANEL_MIN = 320;
const STACKED_MIN = 160;

/** An island's rule along `direction` (VS Code's workbench: the editor
 *  high priority, its side panels low and of a fixed width). `panel` is
 *  the panels' width before the interface scale; `content` the least its
 *  content measured (content-min.ts), which raises the floor across. */
export function islandRule(
  panel: boolean,
  direction: SplitDirection,
  width: number,
  content = 0,
  zoom = 1,
): Omit<SizeRule, "size"> & { pixels: number } {
  if (direction === "column")
    return {
      min: scaledPx(STACKED_MIN),
      pixels: 0,
      fixed: false,
      priority: panel ? "normal" : "high",
    };
  return panel
    ? {
        min: Math.max(scaledPx(PANEL_MIN), content),
        pixels: scaledPx(width),
        fixed: true,
        priority: "low",
      }
    : {
        min: Math.max(docMin(zoom), content),
        pixels: 0,
        fixed: false,
        priority: "high",
      };
}
