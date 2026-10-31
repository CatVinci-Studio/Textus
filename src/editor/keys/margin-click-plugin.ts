import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import type { EditorView } from "@milkdown/kit/prose/view";

/**
 * A click in the page's empty margins, beside the text column, puts the
 * caret in the nearest line at that height, as a click past a line's end
 * does; a shift-click extends the selection there. It used to do nothing: a formula or a block being edited stayed
 * open, however wide the window.
 */
function createMarginClickPlugin() {
  return new Plugin({
    view(view) {
      const scroller = view.dom.closest<HTMLElement>(".editor-scroll");
      const onDown = (event: MouseEvent) => {
        if (event.button !== 0 || event.detail > 1 || !view.editable) return;
        const target = event.target;
        // Only the page around the text: anything drawn there (a margin
        // card, a button) handles its own clicks.
        if (!(target instanceof Node) || !target.contains(view.dom)) return;
        // Between blocks in the text column the editor places the caret, and
        // a drag from there selects.
        if (target === view.dom && inColumn(view, event.clientX)) return;
        // The scroller's own scrollbar.
        if (scroller && onScrollbar(scroller, event)) return;
        const pos = nearestPos(view, event.clientX, event.clientY);
        if (pos === null) return;
        event.preventDefault();
        const { doc, selection } = view.state;
        // With Shift it reaches there from where the selection began.
        const next = event.shiftKey
          ? TextSelection.between(selection.$anchor, doc.resolve(pos))
          : TextSelection.near(doc.resolve(pos));
        view.dispatch(view.state.tr.setSelection(next).scrollIntoView());
        view.focus();
      };
      scroller?.addEventListener("mousedown", onDown);
      return {
        destroy() {
          scroller?.removeEventListener("mousedown", onDown);
        },
      };
    },
  });
}

function inColumn(view: EditorView, x: number): boolean {
  const box = view.dom.getBoundingClientRect();
  const style = getComputedStyle(view.dom);
  return (
    x >= box.left + parseFloat(style.paddingLeft) &&
    x <= box.right - parseFloat(style.paddingRight)
  );
}

function onScrollbar(scroller: HTMLElement, event: MouseEvent): boolean {
  const box = scroller.getBoundingClientRect();
  return (
    event.clientX >= box.left + scroller.clientLeft + scroller.clientWidth ||
    event.clientY >= box.top + scroller.clientTop + scroller.clientHeight
  );
}

/** The document position nearest (x, y), with the point drawn into the
 *  text column. */
function nearestPos(view: EditorView, x: number, y: number): number | null {
  const box = view.dom.getBoundingClientRect();
  const style = getComputedStyle(view.dom);
  const left = box.left + parseFloat(style.paddingLeft) + 1;
  const right = box.right - parseFloat(style.paddingRight) - 1;
  const at = view.posAtCoords({
    left: Math.min(Math.max(x, left), right),
    top: Math.min(Math.max(y, box.top + 1), box.bottom - 1),
  });
  return at ? at.pos : null;
}

export const marginClickPlugin = $prose(createMarginClickPlugin);
