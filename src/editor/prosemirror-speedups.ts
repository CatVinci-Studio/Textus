import { Fragment, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { DecorationSet } from "@milkdown/kit/prose/view";

/**
 * Two of ProseMirror's lookups made logarithmic, with the same
 * answers. Both were linear in the document's top-level blocks and run once
 * per block or per decoration, so a keystroke in a document of millions of
 * characters cost seconds:
 *
 * - `Fragment.findIndex` walked the children from the start. Node
 *   decorations are checked with it every time a decoration set is mapped,
 *   so mapping thousands of them over a long document was quadratic.
 * - `DecorationSet.forChild` scanned every top-level decoration for each
 *   child the view redraws, though only inline ones pass to a child, and
 *   found the child's own set by a linear walk.
 *
 * Measured by `npm run bench:large-doc`. Installed once, from
 * editor-extensions.ts.
 */

/** Below this many children the original walk is as fast. */
const SMALL = 64;

type IndexFound = { index: number; offset: number };

/** Each fragment's children's end positions, built on first use; fragments
 *  never change. */
const ends = new WeakMap<Fragment, Int32Array>();

function endsOf(fragment: Fragment): Int32Array {
  let list = ends.get(fragment);
  if (!list) {
    list = new Int32Array(fragment.childCount);
    let pos = 0;
    for (let i = 0; i < fragment.childCount; i++) {
      pos += fragment.child(i).nodeSize;
      list[i] = pos;
    }
    ends.set(fragment, list);
  }
  return list;
}

/** Fragment.findIndex by binary search over the children's ends. */
export function fastFindIndex(
  fragment: Fragment,
  pos: number,
  original: (pos: number) => IndexFound,
): IndexFound {
  if (fragment.childCount < SMALL || pos <= 0 || pos >= fragment.size)
    return original.call(fragment, pos);
  const list = endsOf(fragment);
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] >= pos) hi = mid;
    else lo = mid + 1;
  }
  const end = list[lo];
  if (end === pos) return { index: lo + 1, offset: end };
  return { index: lo, offset: lo === 0 ? 0 : list[lo - 1] };
}

type SetInternals = DecorationSet & {
  local: { inline: boolean }[];
  children: (number | DecorationSet)[];
};

/** Whether each set holds an inline decoration at its own level. */
const hasInline = new WeakMap<DecorationSet, boolean>();

/** DecorationSet.forChild: the child's own set found by binary search, and
 *  the walk over top-level decorations skipped when none is inline (node
 *  and widget decorations never pass to a child). */
export function fastForChild(
  set: DecorationSet,
  offset: number,
  node: ProseNode,
  original: (offset: number, node: ProseNode) => DecorationSet,
): DecorationSet {
  const inner = set as SetInternals;
  if (set === DecorationSet.empty || node.isLeaf || !inner.children)
    return original.call(set, offset, node);
  let inline = hasInline.get(set);
  if (inline === undefined) {
    inline = inner.local.some((deco) => deco.inline);
    hasInline.set(set, inline);
  }
  if (inline) return original.call(set, offset, node);
  const children = inner.children;
  let lo = 0;
  let hi = children.length / 3;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((children[mid * 3] as number) < offset) lo = mid + 1;
    else hi = mid;
  }
  const at = lo * 3;
  return at < children.length && children[at] === offset
    ? (children[at + 2] as DecorationSet)
    : DecorationSet.empty;
}

let installed = false;

export function installProseMirrorSpeedups() {
  if (installed) return;
  installed = true;
  const fragment = Fragment.prototype as unknown as {
    findIndex: (pos: number) => IndexFound;
  };
  const findIndex = fragment.findIndex;
  fragment.findIndex = function (this: Fragment, pos: number) {
    return fastFindIndex(this, pos, findIndex);
  };
  const decorations = DecorationSet.prototype as unknown as {
    forChild: (offset: number, node: ProseNode) => DecorationSet;
  };
  const forChild = decorations.forChild;
  decorations.forChild = function (
    this: DecorationSet,
    offset: number,
    node: ProseNode,
  ) {
    return fastForChild(this, offset, node, forChild);
  };
}
