import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { Node } from "@milkdown/kit/prose/model";
import { isIOSApp } from "../platform/capabilities";

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

/** A paragraph after the last block, the caret in it, when `y` is below
 *  that block and it takes no text of its own at its end. */
function paragraphBelowEnd(view: EditorView, y: number): boolean {
  if (!view.editable) return false;
  const { doc, schema } = view.state;
  const last = doc.lastChild;
  if (!last || last.isTextblock) return false;
  const dom = view.nodeDOM(doc.content.size - last.nodeSize);
  if (!(dom instanceof HTMLElement)) return false;
  if (y <= dom.getBoundingClientRect().bottom) return false;
  const paragraph = schema.nodes.paragraph?.create();
  if (!paragraph) return false;
  const tr = view.state.tr.insert(doc.content.size, paragraph);
  tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 1));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** A block's own box: a table's, not its wrapper's with the tools' room. */
function boxOf(dom: HTMLElement): DOMRect {
  return (dom.querySelector("table") ?? dom).getBoundingClientRect();
}

/** A table or a picture: a block a tap beside lands nowhere in. */
const holdsNoCaret = (node: Node) =>
  node.type.name === "table" || (node.isBlock && node.isAtom);

/** The caret beside a table or a picture when `y` is in the gap above or
 *  below it: at the end of the text block above, or the start of the one
 *  below. iOS only: its own caret went to the document's last paragraph,
 *  or onto a misspelled word it then selected, so the next key replaced
 *  it. Android places it well, and opens its keyboard only for its own. */
function caretBesideBlock(view: EditorView, y: number): boolean {
  if (!isIOSApp || !view.editable) return false;
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
  if (found < 0) return false;
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, found)),
  );
  return true;
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
