import { Fragment, type Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorState } from "@milkdown/kit/prose/state";
import { LINK } from "../markdown/link-source";

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
 *  that bold in. */
export function outOfSpans(
  state: EditorState,
  pos: number,
  side: -1 | 1,
  spec: FormatSpec,
): number {
  const $pos = state.doc.resolve(pos);
  let moved = pos;
  for (let d = $pos.depth; d > 0 && !$pos.node(d).isTextblock; d--) {
    if (gives($pos.node(d), spec))
      moved = side < 0 ? $pos.before(d) : $pos.after(d);
  }
  return moved;
}
