import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import type { EditorView } from "@milkdown/kit/prose/view";

/** How near the scroller's top or bottom edge the pointer starts it
 *  scrolling, in pixels, and the fastest it goes, in pixels a frame. */
const EDGE = 36;
const MAX_STEP = 40;

/**
 * Pixels a frame a drag-select pointer at `y` asks the scroller to move:
 * more the further into the edge band or past it, up to MAX_STEP; negative
 * upwards.
 */
export function edgeStep(y: number, top: number, bottom: number): number {
  const below = y - (bottom - EDGE);
  const above = top + EDGE - y;
  const ramp = (into: number) => Math.min(MAX_STEP, Math.ceil(into / 3));
  if (below > 0) return ramp(below);
  if (above > 0) return -ramp(above);
  return 0;
}

/**
 * Dragging a selection past the document's top or bottom scrolls it and
 * takes the selection along; WebKitGTK barely scrolls by itself. Each frame
 * tops the scroll up to edgeStep's pace, so a web view that scrolls on its
 * own isn't scrolled twice.
 */
export function createDragAutoscrollPlugin() {
  return new Plugin({
    view(view) {
      let frame = 0;
      let anchor = -1;
      let pointer = { x: 0, y: 0 };
      let last = 0;
      const scroller = () =>
        view.dom.closest<HTMLElement>(".editor-scroll") ?? null;

      const step = () => {
        frame = 0;
        const el = scroller();
        if (!el || anchor < 0) return;
        const rect = el.getBoundingClientRect();
        const want = edgeStep(pointer.y, rect.top, rect.bottom);
        if (want !== 0) {
          // What the web view moved by itself since the last frame counts.
          const own = el.scrollTop - last;
          const rest = Math.sign(want) === Math.sign(own) ? want - own : want;
          if (Math.abs(rest) >= 1 && Math.sign(rest) === Math.sign(want))
            el.scrollTop += rest;
          extendTo(view, anchor, pointer, rect);
        }
        last = el.scrollTop;
        frame = requestAnimationFrame(step);
      };

      const onMove = (event: MouseEvent) => {
        if (!(event.buttons & 1)) return stop();
        pointer = { x: event.clientX, y: event.clientY };
        if (!frame) {
          last = scroller()?.scrollTop ?? 0;
          frame = requestAnimationFrame(step);
        }
      };
      const stop = () => {
        anchor = -1;
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        window.removeEventListener("mousemove", onMove, true);
        window.removeEventListener("mouseup", stop, true);
      };
      const onDown = (event: MouseEvent) => {
        if (event.button !== 0 || event.detail > 1 || event.shiftKey) return;
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
