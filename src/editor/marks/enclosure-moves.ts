import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { isEnclosure, isEnclosureName } from "./enclosure-runs";

/**
 * What an arrow key, Backspace or Delete does at an enclosure's edge, as
 * pure functions of the editor state.
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
 * enclosures nested whole: it looks the same as the inner edge, so stopping
 * there took a press that moved nothing.
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
 * Right arrow, one phase at a time: inside-at-end -> adjacent-after;
 * adjacent-before -> inside-at-start; and the "pin" step onto
 * adjacent-before, which WKWebView can't be trusted to land on itself.
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

  // Leaving adjacent-after: that position is as ambiguous for WKWebView as
  // the one before an enclosure, so this step is taken over too.
  const prev = $pos.nodeBefore;
  if (prev && isEnclosure(prev) && next?.isText) {
    return { pos: pos + 1 };
  }

  return null;
}

/** Mirror of computeArrowRight. */
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

  // Leaving adjacent-before: mirror of the ArrowRight case.
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
 * Backspace deletes the delimiter to its left: the opening one at the start
 * of the content, the closing one right after the node. An empty shell goes
 * whole. Math blocks keep the default rather than unwrap their source.
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

/** Mirror of computeBackspace, deleting to the right. */
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
 * Backspace on the one character right after an inline enclosure
 * ("**3**位|"), or Delete on the one right before. Left to the browser, the
 * caret normalizes into the node and the next keystroke goes bold. Returns
 * the range to delete, or null.
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
 * Backspace/Delete on a selection spanning exactly an enclosure's content
 * leaves an empty shell with the caret inside, as the collapsed-caret case
 * does; a second press removes it. Selections from the node's outer bounds
 * count too, which double-click often gives.
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

/** Strips the node's content, leaving it empty with the caret inside. */
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
