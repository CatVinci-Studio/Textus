import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { Node } from "@milkdown/kit/prose/model";
import { isIOSApp, isMobileApp } from "../platform/capabilities";
import { asDrawn, zoomedRectScale } from "../engine/zoom/zoomed-rects";

/** Where and when a single finger went down: a tap, not a scroll. */
let down: { x: number; y: number; at: number } | null = null;
const TAP_SLOP = 10;
const TAP_MS = 500;

function wasTap(touch: Touch): boolean {
  const start = down;
  down = null;
  return (
    !!start &&
    Math.hypot(touch.clientX - start.x, touch.clientY - start.y) < TAP_SLOP &&
    Date.now() - start.at < TAP_MS
  );
}

/** A table or a picture: a block a tap beside lands nowhere in. */
const holdsNoCaret = (node: Node) =>
  node.type.name === "table" || (node.isBlock && node.isAtom);

/** A paragraph after the last block, the caret in it, when `y` is below
 *  that block and it takes no text of its own at its end: a list or a
 *  quote does, in its last line. */
function paragraphBelowEnd(view: EditorView, y: number): boolean {
  if (!view.editable) return false;
  const { doc, schema } = view.state;
  const last = doc.lastChild;
  if (!last || !holdsNoCaret(last)) return false;
  const dom = view.nodeDOM(doc.content.size - last.nodeSize);
  if (!(dom instanceof HTMLElement)) return false;
  if (y <= boxOf(dom).bottom) return false;
  const paragraph = schema.nodes.paragraph?.create();
  if (!paragraph) return false;
  const tr = view.state.tr.insert(doc.content.size, paragraph);
  tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 1));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** A block's own box as drawn, where a click's `y` is counted: a table's,
 *  not its wrapper's with the tools' room. */
function boxOf(dom: HTMLElement) {
  const own = dom.querySelector<HTMLElement>("table") ?? dom;
  return asDrawn(own.getBoundingClientRect(), zoomedRectScale(own));
}

/** The caret beside a table or a picture when `y` is in the gap above or
 *  below it: at the end of the text block above, or the start of the one
 *  below. On iOS its own caret went to the document's last paragraph, or
 *  onto a misspelled word it then selected, so the next key replaced it;
 *  Android's went under the table or into a cell. Android only with its
 *  keyboard up: it opens it only for its own caret. */
function caretBesideBlock(view: EditorView, y: number): boolean {
  const found = gapCaret(view, y);
  if (found === null) return false;
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, found)),
  );
  holdCaret(view, found);
  return true;
}

/** Where a tap at height `y` in the gap beside a table or a picture puts
 *  the caret (see caretBesideBlock), in the column or its margin; null
 *  outside such a gap, or where the system's own caret is kept. */
export function gapCaret(view: EditorView, y: number): number | null {
  if (!view.editable) return null;
  if (!isIOSApp && !(isMobileApp && view.hasFocus())) return null;
  const { doc } = view.state;
  let found = -1;
  doc.forEach((node, offset, index) => {
    if (found >= 0 || index === 0) return;
    const prev = doc.child(index - 1);
    const text = prev.isTextblock ? prev : node;
    const other = prev.isTextblock ? node : prev;
    if (!text.isTextblock || !holdsNoCaret(other)) return;
    const prevAt = offset - prev.nodeSize;
    const above = view.nodeDOM(prevAt);
    const below = view.nodeDOM(offset);
    if (!(above instanceof HTMLElement) || !(below instanceof HTMLElement))
      return;
    if (y <= boxOf(above).bottom || y >= boxOf(below).top) return;
    // Into the text block of the two: the end of one above, the start of one below.
    found = prev.isTextblock ? offset - 1 : offset + 1;
  });
  return found < 0 ? null : found;
}

const HOLD_MS = 400;

/** With the keyboard up, iOS still puts its own caret after the tap: the
 *  last paragraph. Moved there within a moment, the caret comes back -
 *  until something is typed. */
function holdCaret(view: EditorView, at: number) {
  const until = Date.now() + HOLD_MS;
  const held = view.state.doc;
  // After the editor has read the change.
  const back = () =>
    setTimeout(() => {
      // Typed in since: the caret is after what was typed, and stays.
      if (Date.now() > until || view.state.doc !== held) return stop();
      const { selection, doc } = view.state;
      if (selection.empty && selection.from === at) return;
      stop();
      view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, at)));
    });
  const stop = () => document.removeEventListener("selectionchange", back);
  document.addEventListener("selectionchange", back);
  setTimeout(stop, HOLD_MS);
}

/**
 * A click or tap below the last block when that block takes no text of
 * its own at its end (a table, a code block's frame, a picture): a new
 * paragraph there with the caret in it, as editors give one, instead of
 * the caret going into the block's last cell. A finger's tap is taken at
 * its end, before the web view puts its own caret in that cell: the text
 * typed next went there, or was lost between the two.
 */
export const clickBelowEnd = $prose(
  () =>
    new Plugin({
      props: {
        handleClick: (view, _pos, event) =>
          paragraphBelowEnd(view, event.clientY),
        handleDOMEvents: {
          touchstart(_view, event) {
            const touch = event.touches.length === 1 ? event.touches[0] : null;
            down = touch
              ? { x: touch.clientX, y: touch.clientY, at: Date.now() }
              : null;
            return false;
          },
          touchend(view, event) {
            const touch = event.changedTouches[0];
            if (event.touches.length || !touch || !wasTap(touch)) return false;
            if (
              !paragraphBelowEnd(view, touch.clientY) &&
              !caretBesideBlock(view, touch.clientY)
            )
              return false;
            event.preventDefault();
            view.focus();
            return true;
          },
        },
      },
    }),
);
