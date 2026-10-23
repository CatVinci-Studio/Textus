import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { isEnclosure, isEnclosureName } from "./enclosure-runs";

/**
 * What an arrow key, Backspace or Delete does at an enclosure's edge:
 * step over a delimiter, into or out of a nested one, delete a delimiter
 * or the whole shell (enclosure.ts). Pure functions of the editor state;
 * enclosure-caret.ts applies them.
 */

export interface ArrowMove {
  pos: number;
}

/** An enclosure holding nothing but one other enclosure. */
export function isSoleEnclosureChild(node: ProseNode): boolean {
  return (
    isEnclosure(node) &&
    !node.isBlock &&
    node.childCount === 1 &&
    isEnclosure(node.firstChild!)
  );
}

/**
 * Where an arrow step lands, past the spot between the delimiters of two
 * enclosures nested whole (bold-italic is italic around bold): that spot
 * shows the same as the inner span's edge, so stopping there took a press
 * that moved nothing.
 */
export function pastNestedEdge(
  state: EditorState,
  move: ArrowMove,
  step: 1 | -1,
) {
  let pos = move.pos;
  for (;;) {
    const $pos = state.doc.resolve(pos);
    const parent = $pos.parent;
    if (!isSoleEnclosureChild(parent)) return { pos };
    const offset = $pos.parentOffset;
    if (offset !== 0 && offset !== parent.content.size) return { pos };
    pos += step;
  }
}

/**
 * Right arrow, one phase at a time (see the phase diagram at the top of
 * this file): inside-at-end -> adjacent-after; adjacent-before ->
 * inside-at-start; and the "pin" case, which forces the single native
 * character-step that would otherwise land adjacent-before to go through
 * us instead (see the module doc comment on why WKWebView can't be trusted
 * to land there on its own).
 */
export function computeArrowRight(state: EditorState): ArrowMove | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $pos = sel.$from;
  const pos = sel.from;
  const parent = $pos.parent;

  if (
    isEnclosureName(parent.type.name) &&
    parent.content.size > 0 &&
    $pos.parentOffset === parent.content.size
  ) {
    return { pos: $pos.after($pos.depth) };
  }

  const next = $pos.nodeAfter;
  if (next && isEnclosure(next) && next.content.size > 0) {
    return { pos: pos + 1 };
  }

  if (next?.isText) {
    const upcoming = state.doc.resolve(pos + 1).nodeAfter;
    if (upcoming && isEnclosure(upcoming) && upcoming.content.size > 0) {
      return { pos: pos + 1 };
    }
  }

  // Leaving adjacent-after, moving further away: the position immediately
  // after an enclosure is exactly as ambiguous for WKWebView as the one
  // immediately before it (see the module doc comment) - a widget sits
  // right on the other side of this position too, so this step is taken
  // over rather than ever handed to native movement, symmetric with the
  // "entering" and "pin" cases above.
  const prev = $pos.nodeBefore;
  if (prev && isEnclosure(prev) && next?.isText) {
    return { pos: pos + 1 };
  }

  return null;
}

/** Mirror of computeArrowRight - see its comment for the phase reasoning. */
export function computeArrowLeft(state: EditorState): ArrowMove | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $pos = sel.$from;
  const pos = sel.from;
  const parent = $pos.parent;

  if (
    isEnclosureName(parent.type.name) &&
    parent.content.size > 0 &&
    $pos.parentOffset === 0
  ) {
    return { pos: $pos.before($pos.depth) };
  }

  const prev = $pos.nodeBefore;
  if (prev && isEnclosure(prev) && prev.content.size > 0) {
    return { pos: pos - 1 };
  }

  if (prev?.isText) {
    const upcoming = state.doc.resolve(pos - 1).nodeBefore;
    if (upcoming && isEnclosure(upcoming) && upcoming.content.size > 0) {
      return { pos: pos - 1 };
    }
  }

  // Leaving adjacent-before, moving further away - mirror of the
  // ArrowRight case above.
  const next = $pos.nodeAfter;
  if (next && isEnclosure(next) && prev?.isText) {
    return { pos: pos - 1 };
  }

  return null;
}

export type DeleteAction =
  | { kind: "deleteShell"; start: number; node: ProseNode }
  | {
      kind: "deleteDelimiter";
      start: number;
      node: ProseNode;
      drop: "opening" | "closing";
    };

/**
 * Backspace deletes whichever delimiter is immediately to its left: the
 * opening one if the cursor is at the very start of the content, the
 * closing one if the cursor is adjacent right after the node. An empty
 * shell is removed whole either way. Math blocks are excluded from the
 * "delete opening delimiter" case - their multi-line source doesn't unwrap
 * into a paragraph sensibly, so they keep the block-level default instead.
 */
export function computeBackspace(state: EditorState): DeleteAction | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $pos = sel.$from;
  const pos = sel.from;
  const parent = $pos.parent;

  if (isEnclosureName(parent.type.name)) {
    const start = $pos.before($pos.depth);
    if (parent.content.size === 0)
      return { kind: "deleteShell", start, node: parent };
    if ($pos.parentOffset === 0 && parent.type.name !== "math_block") {
      return { kind: "deleteDelimiter", start, node: parent, drop: "opening" };
    }
    return null;
  }

  const prev = $pos.nodeBefore;
  if (prev && isEnclosure(prev) && !prev.isBlock) {
    const start = pos - prev.nodeSize;
    if (prev.content.size === 0)
      return { kind: "deleteShell", start, node: prev };
    return { kind: "deleteDelimiter", start, node: prev, drop: "closing" };
  }
  return null;
}

/** Mirror of computeBackspace, deleting to the right instead of the left. */
export function computeDelete(state: EditorState): DeleteAction | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $pos = sel.$from;
  const pos = sel.from;
  const parent = $pos.parent;

  if (isEnclosureName(parent.type.name)) {
    const start = $pos.before($pos.depth);
    if (parent.content.size === 0)
      return { kind: "deleteShell", start, node: parent };
    if (
      $pos.parentOffset === parent.content.size &&
      parent.type.name !== "math_block"
    ) {
      return { kind: "deleteDelimiter", start, node: parent, drop: "closing" };
    }
    return null;
  }

  const next = $pos.nodeAfter;
  if (next && isEnclosure(next) && !next.isBlock) {
    if (next.content.size === 0)
      return { kind: "deleteShell", start: pos, node: next };
    return { kind: "deleteDelimiter", start: pos, node: next, drop: "opening" };
  }
  return null;
}

/**
 * Backspace on the one character that directly follows an inline enclosure
 * ("**3**位|" -> "**3**|"), and Delete on the one that directly precedes
 * one. Left to the browser, the deletion leaves the DOM caret normalized
 * into the neighbouring element - at the end (or start) of the bold text,
 * before the revealed closing "**" - and ProseMirror reads that back as a
 * position inside the node, so the next keystroke went bold. Deleting the
 * character ourselves keeps the caret where it was: outside the node,
 * after (or before) its delimiter. Returns the range to delete, or null.
 */
export function computeCharDeleteBesideEnclosure(
  state: EditorState,
  dir: "backward" | "forward",
): { from: number; to: number } | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $pos = sel.$from;
  const text = dir === "backward" ? $pos.nodeBefore : $pos.nodeAfter;
  if (!text?.isText) return null;
  const chars = Array.from(text.text ?? "");
  // Only when a single character separates the caret from the node.
  const char = dir === "backward" ? chars[0] : chars[chars.length - 1];
  if (chars.length !== 1 || !char) return null;
  const from = dir === "backward" ? sel.from - char.length : sel.from;
  const to = from + char.length;
  const $edge = state.doc.resolve(dir === "backward" ? from : to);
  const beside = dir === "backward" ? $edge.nodeBefore : $edge.nodeAfter;
  if (!beside || !isEnclosure(beside) || beside.isBlock) return null;
  return { from, to };
}

/**
 * Backspace/Delete on a RANGE selection that exactly spans an enclosure
 * node's content (selecting all of "hello" in "*hello*" and pressing either
 * key) must not remove the wrapper in the same step - erasing the content
 * should leave an empty, still-bold shell with the cursor inside it, exactly
 * like the empty-shell state computeBackspace/computeDelete already produce
 * for the collapsed-cursor case. A second keypress against that now-empty
 * shell hits the ordinary `content.size === 0` branch in those functions and
 * removes the pair. Two shapes both count as "spans the content": a
 * selection resolved strictly inside the node (both ends share it as their
 * .parent), and one taken from just outside it at the node's own outer
 * bounds (double-click "select word" routinely lands here, since the
 * delimiters are synthesized decorations with no real character of their
 * own to anchor a selection endpoint just inside them).
 */
export function computeRangeDeleteInEnclosure(
  state: EditorState,
): { node: ProseNode; nodeStart: number } | null {
  const sel = state.selection;
  if (sel.empty) return null;
  const { from, to } = sel;
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);

  if ($from.parent === $to.parent && isEnclosureName($from.parent.type.name)) {
    const parent = $from.parent;
    const nodeStart = $from.before($from.depth);
    const contentStart = nodeStart + 1;
    const contentEnd = contentStart + parent.content.size;
    if (parent.content.size > 0 && from === contentStart && to === contentEnd) {
      return { node: parent, nodeStart };
    }
    return null;
  }

  const node = state.doc.nodeAt(from);
  if (
    node &&
    isEnclosure(node) &&
    node.content.size > 0 &&
    to === from + node.nodeSize
  ) {
    return { node, nodeStart: from };
  }

  return null;
}

/** Apply computeRangeDeleteInEnclosure's result: strip the node's content,
 *  leave the (now empty) node in place, caret inside it. */
export function emptyEnclosureContent(
  view: EditorView,
  node: ProseNode,
  nodeStart: number,
): void {
  const contentStart = nodeStart + 1;
  const tr = view.state.tr.delete(
    contentStart,
    contentStart + node.content.size,
  );
  tr.setSelection(TextSelection.create(tr.doc, contentStart));
  view.dispatch(tr);
}
