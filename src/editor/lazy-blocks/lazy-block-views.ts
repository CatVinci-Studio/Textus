import {
  DOMSerializer,
  type Node as ProseNode,
  type Schema,
} from "@milkdown/kit/prose/model";
import type {
  EditorView,
  NodeView,
  NodeViewConstructor,
} from "@milkdown/kit/prose/view";
import { estimateHeight, type TextMetrics } from "./estimate-height";
import {
  flipOf,
  isBlockDrawn,
  lazyBlocksKey,
  topLevelIndex,
  topLevelStarts,
} from "./lazy-blocks-state";

// The views of a long document's top-level blocks: a placeholder of the
// block's height, or the block drawn as it always is. Which one is the
// lazy-blocks plugin's decision; a block that changes from one to the other
// is made anew. Below the threshold every block gets the view it had
// before, so short documents are drawn exactly as without this.

/** Marks a placeholder, for the view that finds them on screen. */
export const PLACEHOLDER_CLASS = "lazy-block";

/** On a heading's placeholder, so the outline still finds every top-level
 *  heading in the DOM, in order. */
export const HEADING_PLACEHOLDER = `.${PLACEHOLDER_CLASS}[data-heading]`;

type NodeViews = Record<string, NodeViewConstructor>;

interface Sizes {
  metrics: TextMetrics | null;
  /** Measured heights, by node: an unchanged block keeps its node. */
  heights: WeakMap<ProseNode, number>;
}

const sizesOf = new WeakMap<EditorView, Sizes>();

function sizes(view: EditorView): Sizes {
  let found = sizesOf.get(view);
  if (!found) {
    found = { metrics: null, heights: new WeakMap() };
    sizesOf.set(view, found);
  }
  return found;
}

/** The node each top-level block's DOM shows, so the view can tell a
 *  block's element from a widget's among the editor's children. */
export const blockNodes = new WeakMap<Element, ProseNode>();

export function rememberHeight(
  view: EditorView,
  node: ProseNode,
  height: number,
): void {
  sizes(view).heights.set(node, height);
}

/** After the text column changed width: every height is wrong. */
export function forgetHeights(view: EditorView): void {
  sizesOf.delete(view);
}

function measureMetrics(view: EditorView): TextMetrics {
  const style = getComputedStyle(view.dom);
  const fontSize = parseFloat(style.fontSize) || 16;
  const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.6;
  const width =
    view.dom.clientWidth -
    (parseFloat(style.paddingLeft) || 0) -
    (parseFloat(style.paddingRight) || 0);
  return {
    lineHeight,
    charsPerLine: Math.max(10, width / fontSize),
    blockGap: fontSize * 0.8,
  };
}

function heightOf(view: EditorView, node: ProseNode): number {
  const known = sizes(view);
  const measured = known.heights.get(node);
  if (measured !== undefined) return measured;
  known.metrics ??= measureMetrics(view);
  return estimateHeight(node, known.metrics);
}

function placeholderView(initial: ProseNode, view: EditorView): NodeView {
  let node = initial;
  const dom = document.createElement("div");
  dom.className = PLACEHOLDER_CLASS;
  dom.style.height = `${heightOf(view, node)}px`;
  if (node.type.name === "heading") dom.dataset.heading = "";
  blockNodes.set(dom, node);
  return {
    dom,
    update(next, decorations) {
      // Drawn by this transaction: made anew as the block.
      if (flipOf(decorations) === true) return false;
      // Changed while out of sight (Replace All): its size anew.
      if (next !== node) dom.style.height = `${heightOf(view, next)}px`;
      node = next;
      blockNodes.set(dom, node);
      return true;
    },
    ignoreMutation: () => true,
  };
}

/** The block as ProseMirror draws a node without a view. Its fourth
 *  argument (untyped) keeps arrays in the node's attributes from being read
 *  as DOM structure, as ProseMirror's own call does. */
function renderDefault(node: ProseNode): NodeView {
  const render = DOMSerializer.renderSpec as (
    ...args: unknown[]
  ) => ReturnType<typeof DOMSerializer.renderSpec>;
  return render(document, node.type.spec.toDOM!(node), null, node.attrs);
}

/** A drawn block: its own view when it has one, else what ProseMirror
 *  draws by default; either way made anew once it should be a placeholder. */
function drawnView(delegate: NodeView | null, initial: ProseNode): NodeView {
  let node = initial;
  const view = delegate ?? renderDefault(node);
  const own = delegate?.update?.bind(delegate);
  view.update = (next, decorations, inner) => {
    // Released by this transaction: made anew as a placeholder.
    if (flipOf(decorations) === false) return false;
    let kept: boolean;
    if (own) kept = own(next, decorations, inner);
    // ProseMirror's own rule for a block it draws: kept while only its
    // content changes.
    else kept = !!view.contentDOM && next.sameMarkup(node);
    if (kept) {
      node = next;
      blockNodes.set(view.dom, node);
    }
    return kept;
  };
  blockNodes.set(view.dom, node);
  return view;
}

function isTopLevel(doc: ProseNode, pos: number): boolean {
  return topLevelStarts(doc)[topLevelIndex(doc, pos)] === pos;
}

/** What lazyBlockNodeViews wrapped, so wrapping again starts from it. */
const baseOf = new WeakMap<NodeViews, NodeViews>();

/** `given` (the editor's node views) with every block type's wrapped. */
export function lazyBlockNodeViews(
  schema: Schema,
  given: NodeViews,
): NodeViews {
  const base = baseOf.get(given) ?? given;
  const views: NodeViews = { ...base };
  baseOf.set(views, base);
  for (const type of Object.values(schema.nodes)) {
    if (!type.isBlock || type === schema.topNodeType || !type.spec.toDOM)
      continue;
    const own = base[type.name] as NodeViewConstructor | undefined;
    views[type.name] = (node, view, getPos, outer, inner) => {
      // Null makes ProseMirror draw the node itself, as without a view.
      const delegate = () =>
        own ? own(node, view, getPos, outer, inner) : null;
      const state = lazyBlocksKey.getState(view.state);
      if (!state?.active) return delegate() as NodeView;
      // At its making the position is known at once, not walked to.
      const pos = getPos();
      if (pos === undefined || !isTopLevel(view.state.doc, pos))
        return delegate() as NodeView;
      if (isBlockDrawn(state, pos, node)) return drawnView(delegate(), node);
      return placeholderView(node, view);
    };
  }
  return views;
}
