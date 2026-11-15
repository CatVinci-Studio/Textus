import type { SplitDirection } from "../layout/tree";
import { scaledPx } from "../tokens/chrome-scale";
import type { SizeRule } from "./distribute";

/** The least a document's island keeps across: a short line of text
 *  (VS Code's editor group keeps 220), the same at any type size or zoom -
 *  a split is refused for want of room only below it. A panel keeps its
 *  settings rows; stacked islands, room for a few lines. */
export const DOC_MIN = 240;
const PANEL_MIN = 352;
const STACKED_MIN = 176;

/** An island's rule along `direction` (VS Code's workbench: the editor
 *  high priority, its side panels low and of a fixed width). `panel` is
 *  the panels' width before the interface scale; `content` the least its
 *  content measured (content-min.ts), which raises the floor across. */
export function islandRule(
  panel: boolean,
  direction: SplitDirection,
  width: number,
  content = 0,
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
        min: Math.max(DOC_MIN, content),
        pixels: 0,
        fixed: false,
        priority: "high",
      };
}
