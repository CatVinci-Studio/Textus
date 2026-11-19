import type { Node as ProseNode } from "@milkdown/kit/prose/model";

// The one rule for what is drawn only near the screen: a long document's
// blocks (lazy-blocks-*) and the heavy views in them (draw-when-visible).

/** Something not drawn this near the screen, in screens above and below,
 *  has everything within DRAW_AHEAD_SCREENS drawn at once: each change to
 *  a long document's blocks restyles all of them (tens of ms in WebKit),
 *  so they change in a few large steps, not a little every frame. */
export const DRAW_SCREENS = 1;
export const DRAW_AHEAD_SCREENS = 2;
/** How far drawn things stay drawn, in screens: the gap keeps one scrolled
 *  just past the edge from being drawn and let go over and over. */
export const KEEP_SCREENS = 4;
/** How long after the last scroll the page is at rest: what is far is let
 *  go then, not while the reader scrolls. */
export const SETTLE_MS = 200;

/** Marks a heavy view not drawn now: not yet, or let go far from the screen. */
export const PENDING_ATTR = "data-draw-pending";
/** Marks a block's placeholder. */
export const PLACEHOLDER_CLASS = "lazy-block";

/** What a node costs to draw, in characters of plain text: a formula is
 *  KaTeX's dozens of elements, a diagram an SVG, an embedded note a whole
 *  editor. */
const WEIGHTS: Record<string, number> = {
  math_inline: 300,
  math_block: 1500,
  html: 800,
  image: 1500,
  obsidian_embed: 5000,
};
const DIAGRAM_WEIGHT = 4000;

function nodeWeight(node: ProseNode): number {
  if (node.type.name === "code_block")
    return node.attrs.language === "mermaid" ? DIAGRAM_WEIGHT : 0;
  return WEIGHTS[node.type.name] ?? 0;
}

/** Each top-level block's weight, by node: an unchanged block keeps its
 *  node, so an edit weighs only the block it touched. */
const blockWeights = new WeakMap<ProseNode, number>();
const docWeights = new WeakMap<ProseNode, number>();

function blockWeight(block: ProseNode): number {
  let found = blockWeights.get(block);
  if (found === undefined) {
    found = block.nodeSize + nodeWeight(block);
    block.descendants((node) => {
      found! += nodeWeight(node);
    });
    blockWeights.set(block, found);
  }
  return found;
}

/** How heavy a document is to draw: its text and what draws heavily. */
function docWeight(doc: ProseNode): number {
  let found = docWeights.get(doc);
  if (found === undefined) {
    found = 0;
    for (let i = 0; i < doc.childCount; i++) found += blockWeight(doc.child(i));
    docWeights.set(doc, found);
  }
  return found;
}

/** Above this weight heavy views wait to be drawn until they come near
 *  the screen; below it they are drawn at once (still let go far away). */
const VIEWS_WAIT_WEIGHT = 100_000;
/** Above this weight a block out of sight is a placeholder of its height.
 *  Once on, it stays on until the weight falls a tenth below, so typing at
 *  the edge doesn't redraw the document back and forth. */
const BLOCKS_WEIGHT = 150_000;

export function viewsWaitForScreen(doc: ProseNode): boolean {
  return docWeight(doc) > VIEWS_WAIT_WEIGHT;
}

export function drawsLazily(doc: ProseNode): boolean {
  return docWeight(doc) > BLOCKS_WEIGHT;
}

export function keepsDrawingLazily(doc: ProseNode): boolean {
  return docWeight(doc) > BLOCKS_WEIGHT * 0.9;
}
