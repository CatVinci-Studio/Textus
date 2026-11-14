import { Fragment, type Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorState } from "@milkdown/kit/prose/state";
import { LINK } from "../markdown/link-source";
import { isEnclosureName } from "../marks/enclosure-runs";

export interface FormatSpec {
  delim: string;
  rung: number;
}

/** Inline nodes besides text a selection may hold to be made bold or
 *  italic: verbatim ones, with no formatting of their own to clash. */
const WRAPPABLE = new Set(["md_code_span", "math_inline", LINK]);

const isSpan = (node: ProseNode) => node.type.name === "md_span";

/** A span that already gives `spec`: the same, or `***` for bold or italic. */
export const gives = (node: ProseNode, spec: FormatSpec) =>
  isSpan(node) &&
  node.attrs.delim === spec.delim &&
  (node.attrs.rung === spec.rung || node.attrs.rung === 3);

/**
 * `content` ready to go inside one new `spec` span: spans of that style
 * inside give way to their words (a `***` keeps its other half), other
 * styles stay nested. Null when it holds something that can't be wrapped.
 */
export function mergedContent(
  content: Fragment,
  spec: FormatSpec,
): Fragment | null {
  const out: ProseNode[] = [];
  for (let i = 0; i < content.childCount; i++) {
    const child = content.child(i);
    if (child.isText || WRAPPABLE.has(child.type.name)) {
      out.push(child);
      continue;
    }
    if (!isSpan(child)) return null;
    const inner = mergedContent(child.content, spec);
    if (!inner) return null;
    if (!gives(child, spec)) out.push(child.copy(inner));
    else if (child.attrs.rung === 3)
      out.push(
        child.type.create({ ...child.attrs, rung: 3 - spec.rung }, inner),
      );
    else inner.forEach((node) => out.push(node));
  }
  return Fragment.from(out);
}

/** `pos` moved out of every `spec` span it sits inside, to that span's
 *  start (`side` -1) or end (1), so a selection half in bold takes all of
 *  that bold in - with the spans around it (`***` loads as italic around
 *  bold), which stay nested inside the new one. */
export function outOfSpans(
  state: EditorState,
  pos: number,
  side: -1 | 1,
  spec: FormatSpec,
): number {
  const $pos = state.doc.resolve(pos);
  let outer = 0;
  let found = false;
  for (let d = $pos.depth; d > 0 && !$pos.node(d).isTextblock; d--) {
    if (!isSpan($pos.node(d))) break;
    outer = d;
    found ||= gives($pos.node(d), spec);
  }
  if (!found) return pos;
  return side < 0 ? $pos.before(outer) : $pos.after(outer);
}

/** `pos` moved out of the spans whose very start (`side` -1) or end (1) it
 *  sits at: a selection from before a bold to the end of its text is all of
 *  it, one ending inside its text is not. */
export function outAtEdges(
  state: EditorState,
  pos: number,
  side: -1 | 1,
): number {
  for (;;) {
    const $pos = state.doc.resolve(pos);
    const at =
      side < 0
        ? $pos.parentOffset === 0
        : $pos.parentOffset === $pos.parent.content.size;
    if (!isSpan($pos.parent) || !at) return pos;
    pos = side < 0 ? $pos.before() : $pos.after();
  }
}

/** The `spec` span a selection from `from` to `to` is all of, its ends just
 *  inside or just outside, and where it starts and ends. `***` loads as
 *  italic around bold: the span looked for may be inside the one there. */
export function spanCovering(
  state: EditorState,
  from: number,
  to: number,
  spec: FormatSpec,
): { node: ProseNode; from: number; to: number } | null {
  let start = outAtEdges(state, from, -1);
  const end = outAtEdges(state, to, 1);
  let node = state.doc.nodeAt(start);
  if (!node || start + node.nodeSize !== end) return null;
  while (!gives(node, spec) && node.childCount === 1) {
    const inner: ProseNode = node.firstChild!;
    if (!isSpan(inner)) return null;
    node = inner;
    start += 1;
  }
  return gives(node, spec)
    ? { node, from: start, to: start + node.nodeSize }
    : null;
}

/** What of each textblock a selection over several holds, trimmed of edge
 *  whitespace: the ranges a shortcut wraps or unwraps. Code, maths and
 *  enclosure blocks are left out. */
export function blockRanges(
  state: EditorState,
): { from: number; to: number }[] {
  const { from, to } = state.selection;
  const ranges: { from: number; to: number }[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.spec.code || isEnclosureName(node.type.name)) return false;
    const start = Math.max(from, pos + 1);
    const end = Math.min(to, pos + 1 + node.content.size);
    // Only a text node's edge whitespace stays outside: spaces in code are code.
    const part = state.doc.slice(start, end).content;
    const edge = (child: ProseNode | null, pattern: RegExp) =>
      child?.isText ? pattern.exec(child.text!)![0].length : 0;
    const lead = edge(part.firstChild, /^\s*/);
    const trail = edge(part.lastChild, /\s*$/);
    if (start + lead < end - trail)
      ranges.push({ from: start + lead, to: end - trail });
    return false;
  });
  return ranges;
}
