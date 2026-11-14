import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  TextSelection,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { isEnclosureName } from "../marks/enclosure-runs";
import { caretAt, stateWithLiveSelection } from "../live-selection";
import { blockRanges } from "./format-merge";

const CODE = "md_code_span";
/** What code can take in: its text kept, any formatting given up. */
const TAKES = new Set(["text", "md_span", CODE]);

type Range = { from: number; to: number };

/** `pos` moved out of a code it sits in, and out of spans it sits at an
 *  edge of, to the `side` it leans: a selection half in code takes it all. */
function outward(doc: ProseNode, pos: number, side: -1 | 1): number {
  for (;;) {
    const $pos = doc.resolve(pos);
    const parent = $pos.parent;
    const atEdge =
      side < 0
        ? $pos.parentOffset === 0
        : $pos.parentOffset === parent.content.size;
    if (parent.type.name === CODE || (parent.type.name === "md_span" && atEdge))
      pos = side < 0 ? $pos.before() : $pos.after();
    else return pos;
  }
}

/** The code `range` is all of, either end inside it or just outside, and
 *  where it starts and ends; null if it is not one code. */
function codeAt(state: EditorState, range: Range) {
  // Out of a code only from its very start or end: one end inside its
  // text is part of it, not all.
  const out = (pos: number, side: -1 | 1) => {
    const $pos = state.doc.resolve(pos);
    const edge =
      side < 0
        ? $pos.parentOffset === 0
        : $pos.parentOffset === $pos.parent.content.size;
    if ($pos.parent.type.name !== CODE || !edge) return pos;
    return side < 0 ? $pos.before() : $pos.after();
  };
  const from = out(range.from, -1);
  const to = out(range.to, 1);
  const node = state.doc.nodeAt(from);
  return node?.type.name === CODE && from + node.nodeSize === to
    ? { node, from, to }
    : null;
}

/** `range` made one code on `tr`: formatting inside given up, codes inside
 *  merged. Where its text starts and how long it is; null when it holds
 *  something code can't take in. */
function wrapCode(
  state: EditorState,
  tr: Transaction,
  range: Range,
): { at: number; size: number } | null {
  const from = outward(state.doc, range.from, -1);
  const to = outward(state.doc, range.to, 1);
  const $from = state.doc.resolve(from);
  let block = $from.parent;
  for (let d = $from.depth; !block.isTextblock && d > 0;)
    block = $from.node(--d);
  if (block.type.spec.code || isEnclosureName(block.type.name)) return null;
  let takes = true;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isInline && !TAKES.has(node.type.name)) takes = false;
    return takes;
  });
  const text = state.doc.textBetween(from, to);
  if (!takes || !text) return null;
  tr.delete(tr.mapping.map(from), tr.mapping.map(to, -1));
  // Out of a span the cut leaves the code at the edge of, so the code isn't
  // formatted by what was outside the selection.
  const at = outward(tr.doc, tr.mapping.map(from, -1), 1);
  tr.insert(at, state.schema.nodes[CODE].create({}, state.schema.text(text)));
  return { at: at + 1, size: text.length };
}

/** A selection over several textblocks: each part made code, or, when
 *  every part already is, each taken off. */
function acrossBlocks(state: EditorState): Transaction | null {
  const ranges = blockRanges(state);
  if (ranges.length === 0) return null;
  const tr = state.tr;
  const allOn = ranges.every((range) => codeAt(state, range));
  for (const range of [...ranges].reverse()) {
    const on = codeAt(state, range);
    if (allOn) tr.replaceWith(on!.from, on!.to, on!.node.content);
    else if (!on && !wrapCode(state, tr, range)) return null;
  }
  const { from, to } = state.selection;
  return tr.setSelection(
    TextSelection.create(tr.doc, tr.mapping.map(from, -1), tr.mapping.map(to)),
  );
}

/**
 * Inline code, Ctrl+`, by the rules bold follows: the selection made one
 * code, formatting in it given up and codes in it merged, a code it reaches
 * into taken in whole; again on code takes it off. Nothing selected opens
 * an empty code, as typing "`" does.
 */
export function toggleCodeSpan(view: EditorView): boolean {
  const state = stateWithLiveSelection(view);
  const code = state.schema.nodes[CODE];
  const { $from, $to, from, to, empty } = state.selection;
  if (!code) return false;
  if ($from.parent.type === code && $from.sameParent($to)) {
    const start = $from.before();
    const tr = state.tr.replaceWith(start, $from.after(), $from.parent.content);
    view.dispatch(
      tr.setSelection(TextSelection.create(tr.doc, from - 1, to - 1)),
    );
    return true;
  }
  const whole = !empty && codeAt(state, { from, to });
  if (whole) {
    const tr = state.tr.replaceWith(whole.from, whole.to, whole.node.content);
    view.dispatch(
      tr.setSelection(TextSelection.create(tr.doc, whole.from, whole.to - 2)),
    );
    return true;
  }
  const parent = $from.parent;
  if (empty) {
    if (!parent.isTextblock || parent.type.spec.code) return false;
    if (isEnclosureName(parent.type.name)) return false;
    view.dispatch(caretAt(state.tr.insert(from, code.create()), from + 1));
    return true;
  }
  if (!(state.selection instanceof TextSelection) || !sameBlock(state)) {
    const tr = acrossBlocks(state);
    if (tr) view.dispatch(tr);
    return !!tr;
  }
  const tr = state.tr;
  const made = wrapCode(state, tr, { from, to });
  if (!made) return false;
  view.dispatch(
    tr.setSelection(TextSelection.create(tr.doc, made.at, made.at + made.size)),
  );
  return true;
}

/** Both ends in one textblock, at any depth of spans. */
function sameBlock(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  const depth = $from.sharedDepth($to.pos);
  for (let d = depth; d >= 0; d--) if ($from.node(d).isTextblock) return true;
  return false;
}
