import type { EditorView } from "@milkdown/kit/prose/view";
import { scrollerOf } from "../../editor/modes/mode-switch";

/** Room kept above or below the caret's line at the top or the bottom. */
const SCROLL_MARGIN = 24;

/** The caret's line to the middle, top or bottom of the editor's scroller:
 *  the `scroll` editor op, Vim's zz, zt and zb. */
export function scrollCaretTo(
  view: EditorView,
  to: "center" | "top" | "bottom",
) {
  const scroller = scrollerOf(view.dom);
  if (!scroller) return;
  const line = view.coordsAtPos(view.state.selection.head);
  const box = scroller.getBoundingClientRect();
  const height = line.bottom - line.top;
  const target =
    to === "top"
      ? SCROLL_MARGIN
      : to === "bottom"
        ? box.height - height - SCROLL_MARGIN
        : (box.height - height) / 2;
  scroller.scrollTop += line.top - box.top - target;
}
