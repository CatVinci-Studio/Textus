import { Plugin, Selection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { isImeKeyEvent, stateWithLiveSelection } from "../marks/enclosure";
import { isMacPlatform } from "../../platform/os";

/** The displayed line's boundary. Native WebKit navigation can stop at the
 *  contenteditable=false markers, so coordinates are binary-searched. */
export function visualLineBoundary(
  view: EditorView,
  head: number,
  direction: -1 | 1,
): number {
  const $head = view.state.doc.resolve(head);
  let depth = $head.depth;
  while (depth > 0 && !$head.node(depth).isTextblock) depth--;
  if (depth === 0) return head;

  const caret = view.coordsAtPos(head);
  let low = direction < 0 ? $head.start(depth) : head;
  let high = direction < 0 ? head : $head.end(depth);
  while (low < high) {
    const mid =
      direction < 0
        ? Math.floor((low + high) / 2)
        : Math.ceil((low + high) / 2);
    const rect = view.coordsAtPos(mid, -direction);
    // Inline fonts may have different heights; overlap identifies one line.
    if (direction < 0) {
      if (rect.bottom <= caret.top) low = mid + 1;
      else high = mid;
    } else {
      if (rect.top >= caret.bottom) high = mid - 1;
      else low = mid;
    }
  }
  return low;
}

export function createMacNavigationPlugin(isMac = isMacPlatform) {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (
          !isMac() ||
          !event.metaKey ||
          event.altKey ||
          event.ctrlKey ||
          isImeKeyEvent(view, event) ||
          !view.editable
        )
          return false;
        const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
        const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
        if (!backward && !forward) return false;

        const { selection, doc } = stateWithLiveSelection(view);
        const direction = backward ? -1 : 1;
        const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
        if (!vertical && !selection.$head.parent.inlineContent) return false;
        const target = vertical
          ? (backward ? Selection.atStart(doc) : Selection.atEnd(doc)).head
          : visualLineBoundary(view, selection.head, direction);
        const $target = doc.resolve(target);
        const next = event.shiftKey
          ? TextSelection.between(selection.$anchor, $target, direction)
          : Selection.near($target, direction);
        view.dispatch(view.state.tr.setSelection(next).scrollIntoView());
        return true;
      },
    },
  });
}

export const macNavigationPlugin = $prose(() => createMacNavigationPlugin());
