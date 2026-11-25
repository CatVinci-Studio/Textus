import { Plugin, Selection, TextSelection } from "@milkdown/kit/prose/state";
import type { Node as ProseNode, ResolvedPos } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { stateWithLiveSelection } from "../live-selection";
import { isImeKeyEvent } from "./ime";
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
  // A code line ends at its "\n", whose coordinates read as the line
  // before's end or the next's start: the search stops at it.
  if ($head.node(depth).type.spec.code) {
    const start = $head.start(depth);
    const text = $head.node(depth).textContent;
    if (direction < 0 && head > start)
      low = start + text.lastIndexOf("\n", head - start - 1) + 1;
    else if (text.indexOf("\n", head - start) >= 0)
      high = start + text.indexOf("\n", head - start);
  }
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

/** Cmd+Backspace, done on the document: WebKit's own stalls at a line that
 *  starts beside a non-editable element (a heading's "#", a code block's
 *  first line) and loses the caret. */
function deleteToLineStart(view: EditorView): boolean {
  const { selection } = stateWithLiveSelection(view);
  if (!selection.empty || !selection.$head.parent.inlineContent) return false;
  const start = visualLineBoundary(view, selection.head, -1);
  if (start === selection.head) return false;
  view.dispatch(view.state.tr.delete(start, selection.head).scrollIntoView());
  return true;
}

/** Ctrl+Home and Ctrl+End (Cmd on a Mac), done on the document: the
 *  browser's own moved the caret before the source shown where it was
 *  (a fold's, a heading's) closed behind it, and the editor drew the caret
 *  back from where it had been. */
function toDocumentEdge(view: EditorView, event: KeyboardEvent): boolean {
  const { selection, doc } = stateWithLiveSelection(view);
  const backward = event.key === "Home";
  const $target = doc.resolve(
    (backward ? Selection.atStart(doc) : Selection.atEnd(doc)).head,
  );
  const direction = backward ? -1 : 1;
  const next = event.shiftKey
    ? TextSelection.between(selection.$anchor, $target, direction)
    : Selection.near($target, direction);
  view.dispatch(view.state.tr.setSelection(next).scrollIntoView());
  return true;
}

/** Cmd+Up and Cmd+Down in a code block: its own first or last line, then
 *  the document's ends. */
function verticalTarget(
  doc: ProseNode,
  $head: ResolvedPos,
  backward: boolean,
): number {
  if ($head.parent.type.spec.code) {
    const edge = backward ? $head.start() : $head.end();
    if ($head.pos !== edge) return edge;
  }
  return (backward ? Selection.atStart(doc) : Selection.atEnd(doc)).head;
}

/** Cmd+Arrow on a Mac, and Home or End: the line's ends, or (up and down)
 *  the block's or document's. WebKit's own leaves a code line, and its
 *  Home or End can type the key's private-use character. */
function toLineOrBlockEdge(view: EditorView, event: KeyboardEvent): boolean {
  const { selection, doc } = stateWithLiveSelection(view);
  const backward = ["ArrowLeft", "ArrowUp", "Home"].includes(event.key);
  const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
  if (!vertical && !selection.$head.parent.inlineContent) return false;
  const direction = backward ? -1 : 1;
  const target = vertical
    ? verticalTarget(doc, selection.$head, backward)
    : visualLineBoundary(view, selection.head, direction);
  const $target = doc.resolve(target);
  const next = event.shiftKey
    ? TextSelection.between(selection.$anchor, $target, direction)
    : Selection.near($target, direction);
  view.dispatch(view.state.tr.setSelection(next).scrollIntoView());
  return true;
}

export function createMacNavigationPlugin(isMac = isMacPlatform) {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (
          (event.key === "Home" || event.key === "End") &&
          (isMac() ? event.metaKey : event.ctrlKey) &&
          !event.altKey &&
          !isImeKeyEvent(view, event)
        )
          return toDocumentEdge(view, event);
        const plainHomeEnd =
          (event.key === "Home" || event.key === "End") &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey;
        if (
          plainHomeEnd &&
          isMac() &&
          view.editable &&
          !isImeKeyEvent(view, event)
        )
          return toLineOrBlockEdge(view, event);
        if (
          !isMac() ||
          !event.metaKey ||
          event.altKey ||
          event.ctrlKey ||
          isImeKeyEvent(view, event) ||
          !view.editable
        )
          return false;
        if (event.key === "Backspace" && !event.shiftKey)
          return deleteToLineStart(view);
        const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
        const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
        if (!backward && !forward) return false;
        return toLineOrBlockEdge(view, event);
      },
    },
  });
}

export const macNavigationPlugin = $prose(() => createMacNavigationPlugin());
