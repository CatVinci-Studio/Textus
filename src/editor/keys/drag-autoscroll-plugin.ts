import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import type { EditorView } from "@milkdown/kit/prose/view";
import { edgeScroll } from "../../engine/drag/edge-scroll";

/**
 * Dragging a selection past the document's top or bottom scrolls it and
 * takes the selection along; WebKitGTK barely scrolls by itself. The scroll
 * is topped up to edgeScroll's pace, so a web view that scrolls on its own
 * isn't scrolled twice.
 */
function createDragAutoscrollPlugin() {
  return new Plugin({
    view(view) {
      let anchor = -1;
      let pointer = { x: 0, y: 0 };
      const edge = edgeScroll(
        () => view.dom.closest<HTMLElement>(".editor-scroll") ?? null,
        (rect, atEdge) => {
          if (atEdge && rect && anchor >= 0)
            extendTo(view, anchor, pointer, rect);
        },
        { topUp: true },
      );

      const onMove = (event: MouseEvent) => {
        if (!(event.buttons & 1)) return stop();
        pointer = { x: event.clientX, y: event.clientY };
        edge.at(pointer.y);
      };
      const stop = () => {
        anchor = -1;
        edge.stop();
        window.removeEventListener("mousemove", onMove, true);
        window.removeEventListener("mouseup", stop, true);
      };
      const onDown = (event: MouseEvent) => {
        if (event.button !== 0 || event.detail > 1 || event.shiftKey) return;
        // Taken by something else (a margin press follows its own drag):
        // the web view starts no selection to carry along.
        if (event.defaultPrevented) return;
        // Where the press is: ProseMirror puts the caret there only later.
        const at = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        if (!at) return;
        anchor = at.pos;
        window.addEventListener("mousemove", onMove, true);
        window.addEventListener("mouseup", stop, true);
      };
      view.dom.addEventListener("mousedown", onDown);
      return {
        destroy() {
          stop();
          view.dom.removeEventListener("mousedown", onDown);
        },
      };
    },
  });
}

/** The selection from `anchor` to the text under the pointer, held inside
 *  the scroller's box. */
function extendTo(
  view: EditorView,
  anchor: number,
  pointer: { x: number; y: number },
  rect: DOMRect,
) {
  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(Math.max(v, lo + 2), hi - 2);
  const at = view.posAtCoords({
    left: clamp(pointer.x, rect.left, rect.right),
    top: clamp(pointer.y, rect.top, rect.bottom),
  });
  const { doc, selection } = view.state;
  // A cell selection across a table, or a picture picked: scrolled, kept.
  if (!at || !(selection instanceof TextSelection)) return;
  if (selection.anchor === anchor && selection.head === at.pos) return;
  const next = TextSelection.between(doc.resolve(anchor), doc.resolve(at.pos));
  view.dispatch(view.state.tr.setSelection(next));
}

export const dragAutoscrollPlugin = $prose(createDragAutoscrollPlugin);
