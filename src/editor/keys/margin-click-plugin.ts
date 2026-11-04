import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import type { EditorView } from "@milkdown/kit/prose/view";
import { edgeStep } from "./drag-autoscroll-plugin";

/**
 * A click in the page's empty margins, beside the text column, puts the
 * caret in the nearest line at that height, as a click past a line's end
 * does; a shift-click extends the selection there. It used to do nothing: a formula or a block being edited stayed
 * open, however wide the window. A drag from the margin selects the lines
 * it passes, as a drag from the text does.
 */
function createMarginClickPlugin() {
  return new Plugin({
    view(view) {
      const scroller = view.dom.closest<HTMLElement>(".editor-scroll");
      let endDrag = () => {};
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
        // The press was kept from the web view, so it selects nothing as
        // the mouse moves on: the drag is followed here.
        endDrag();
        endDrag = followDrag(view, scroller, next.anchor);
      };
      // Captured, so the editor's own mousedown handlers see the press is
      // taken and start no selection of their own.
      scroller?.addEventListener("mousedown", onDown, true);
      return {
        destroy() {
          endDrag();
          scroller?.removeEventListener("mousedown", onDown, true);
        },
      };
    },
  });
}

/**
 * Selects from `anchor` to the text nearest the pointer until the button is
 * let go, scrolling on past the scroller's top or bottom at edgeStep's pace.
 * One update a frame, however fast the mouse moves. Returns its stop.
 */
function followDrag(
  view: EditorView,
  scroller: HTMLElement | null,
  anchor: number,
): () => void {
  let pointer = { x: 0, y: 0 };
  let frame = 0;
  const follow = (rect?: DOMRect) => {
    const head = nearestPos(view, pointer.x, pointer.y, rect);
    const { doc, selection } = view.state;
    if (
      head === null ||
      (selection.anchor === anchor && selection.head === head)
    )
      return;
    const next = TextSelection.between(doc.resolve(anchor), doc.resolve(head));
    view.dispatch(view.state.tr.setSelection(next));
  };
  const step = () => {
    frame = 0;
    const rect = scroller?.getBoundingClientRect();
    const by = rect ? edgeStep(pointer.y, rect.top, rect.bottom) : 0;
    if (scroller && by) scroller.scrollTop += by;
    follow(rect);
    // Held past an edge, it scrolls on without a move.
    if (by) frame = requestAnimationFrame(step);
  };
  const move = (event: MouseEvent) => {
    if (!(event.buttons & 1)) return stop();
    pointer = { x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(step);
  };
  // The button can be let go before the last move's frame: it still counts.
  const up = () => {
    if (frame) follow(scroller?.getBoundingClientRect());
    stop();
  };
  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    window.removeEventListener("mousemove", move, true);
    window.removeEventListener("mouseup", up, true);
  };
  window.addEventListener("mousemove", move, true);
  window.addEventListener("mouseup", up, true);
  return stop;
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
 *  text column, and into `shown` when given: off screen it hits nothing. */
function nearestPos(
  view: EditorView,
  x: number,
  y: number,
  shown?: DOMRect,
): number | null {
  const box = view.dom.getBoundingClientRect();
  const style = getComputedStyle(view.dom);
  const left = box.left + parseFloat(style.paddingLeft) + 1;
  const right = box.right - parseFloat(style.paddingRight) - 1;
  const top = Math.max(box.top, shown?.top ?? -Infinity) + 1;
  const bottom = Math.min(box.bottom, shown?.bottom ?? Infinity) - 1;
  const at = view.posAtCoords({
    left: Math.min(Math.max(x, left), right),
    top: Math.min(Math.max(y, top), bottom),
  });
  return at ? at.pos : null;
}

export const marginClickPlugin = $prose(createMarginClickPlugin);
