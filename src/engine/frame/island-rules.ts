import type { SplitDirection } from "../layout/tree";
import { scaledPx } from "../tokens/chrome-scale";
import type { SizeRule } from "./distribute";

/** The least an island keeps: a document's column of text, a panel's
 *  settings rows; stacked, room for a few lines. */
export const DOC_MIN = 360;
const PANEL_MIN = 320;
const STACKED_MIN = 160;

/** An island's rule along `direction` (VS Code's workbench: the editor
 *  high priority, its side panels low and of a fixed width). `panel` is
 *  the panels' width before the interface scale. */
export function islandRule(
  panel: boolean,
  direction: SplitDirection,
  width: number,
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
        min: scaledPx(PANEL_MIN),
        pixels: scaledPx(width),
        fixed: true,
        priority: "low",
      }
    : { min: scaledPx(DOC_MIN), pixels: 0, fixed: false, priority: "high" };
}
