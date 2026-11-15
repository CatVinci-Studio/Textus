import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

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

/** The caret at the start of the block after a table (or a picture, a
 *  code block's frame) when `y` is in the gap between them. A finger's tap
 *  there otherwise lets iOS place it, and a misspelled first word is then
 *  taken as tapped: selected, so the next key replaced it. */
function caretBelowBlock(view: EditorView, y: number): boolean {
  if (!view.editable) return false;
  const { doc } = view.state;
  let found = -1;
  doc.forEach((node, offset, index) => {
    if (found >= 0 || node.isTextblock || index === doc.childCount - 1) return;
    const next = doc.child(index + 1);
    const above = view.nodeDOM(offset);
    const below = view.nodeDOM(offset + node.nodeSize);
    if (!next.isTextblock) return;
    if (!(above instanceof HTMLElement) || !(below instanceof HTMLElement))
      return;
    const bottom = above.getBoundingClientRect().bottom;
    const top = below.getBoundingClientRect().top;
    if (y > bottom && y < top) found = offset + node.nodeSize + 1;
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
              !caretBelowBlock(view, touch.clientY)
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
