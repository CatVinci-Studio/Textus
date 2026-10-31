import type { Node as ProseNode, ResolvedPos } from "@milkdown/kit/prose/model";
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { drawsLazily, keepsDrawingLazily } from "../large-doc";

// Which top-level blocks of a long document are drawn. The document itself
// is always whole - saving, find, the outline and undo read it - but only
// the blocks near the screen get DOM; every other one is a placeholder of
// its height. This module only decides which; the view draws them.

export interface LazyBlocksState {
  /** Off for documents below the threshold: every block drawn, as before. */
  active: boolean;
  /** The top-level blocks drawn in full, each a node decoration; while
   *  active, every other top-level block is a placeholder. Kept here, not
   *  given to the view: ProseMirror matches each top-level block against
   *  every decoration at the top on every update, so a hundred of them over
   *  20,000 blocks would cost each keystroke millions of comparisons. */
  drawn: DecorationSet;
  /** What the view is given: the blocks this transaction drew or released,
   *  marked with which, so their views are made anew. Usually empty. */
  flips: DecorationSet;
}

/** Positions are the starts of top-level blocks in the document the
 *  transaction starts from. */
export type LazyBlocksMeta =
  { draw?: readonly number[]; release?: readonly number[] } | { drawAll: true };

export const lazyBlocksKey = new PluginKey<LazyBlocksState>("lazy-blocks");

/** Blocks drawn either side of the caret's before the view has measured
 *  what is on screen: a few screens' worth of short paragraphs. */
const FIRST_DRAWN = 40;

/** A change larger than this (in positions, about characters) is drawn
 *  only at its ends; the view draws what of it reaches the screen. */
const LARGE_CHANGE = 20_000;

/** Marks a node decoration as this plugin's. */
const SPEC = { lazyBlockDrawn: true } as const;

const INACTIVE: LazyBlocksState = {
  active: false,
  drawn: DecorationSet.empty,
  flips: DecorationSet.empty,
};

interface FlipSpec {
  lazyBlockFlip: boolean;
}

/** From a node's outer decorations: true when this transaction drew it,
 *  false when it released it, undefined when neither. */
export function flipOf(
  decorations: readonly Decoration[],
): boolean | undefined {
  for (const d of decorations) {
    const flip = (d.spec as Partial<FlipSpec>).lazyBlockFlip;
    if (flip !== undefined) return flip;
  }
  return undefined;
}

/** Whether the top-level block `node` at `from` is drawn in full. */
export function isBlockDrawn(
  state: LazyBlocksState,
  from: number,
  node: ProseNode,
): boolean {
  return isDrawnAt(state.drawn, from, node);
}

/** The starts of a document's top-level blocks, built the first time a
 *  document is asked about (every edit makes a new one): finding a block by
 *  position is then a binary search, not ProseMirror's walk over them. */
const startsOf = new WeakMap<ProseNode, number[]>();

export function topLevelStarts(doc: ProseNode): number[] {
  let starts = startsOf.get(doc);
  if (!starts) {
    const built: number[] = [];
    doc.forEach((_node, pos) => built.push(pos));
    startsOf.set(doc, built);
    starts = built;
  }
  return starts;
}

/** The index of the top-level block holding `pos` (the last one starting
 *  at or before it). */
export function topLevelIndex(doc: ProseNode, pos: number): number {
  const starts = topLevelStarts(doc);
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= pos) low = mid;
    else high = mid - 1;
  }
  return low;
}

function topLevelBlock(doc: ProseNode, pos: number) {
  const index = topLevelIndex(doc, pos);
  return { from: topLevelStarts(doc)[index], node: doc.child(index) };
}

/** The top-level block holding `$pos`; at the top level itself, the one
 *  after it (or before it, at the end). */
function blockAt($pos: ResolvedPos): { from: number; node: ProseNode } | null {
  if ($pos.depth > 0) return { from: $pos.before(1), node: $pos.node(1) };
  const after = $pos.nodeAfter;
  if (after) return { from: $pos.pos, node: after };
  const before = $pos.nodeBefore;
  return before ? { from: $pos.pos - before.nodeSize, node: before } : null;
}

/** This plugin's decorations overlapping the block (find also returns the
 *  neighbours' that only touch it). */
function drawnAt(drawn: DecorationSet, from: number, node: ProseNode) {
  const to = from + node.nodeSize;
  return drawn
    .find(
      from,
      to,
      (spec) => (spec as Partial<typeof SPEC>).lazyBlockDrawn === true,
    )
    .filter((d) => d.from < to && d.to > from);
}

function isDrawnAt(drawn: DecorationSet, from: number, node: ProseNode) {
  return drawnAt(drawn, from, node).some(
    (d) => d.from === from && d.to === from + node.nodeSize,
  );
}

/** Marks the top-level blocks overlapping `from`-`to` drawn, replacing any
 *  decoration a split or join left spanning the wrong range. */
function drawRange(
  drawn: DecorationSet,
  doc: ProseNode,
  from: number,
  to: number,
): DecorationSet {
  const add: Decoration[] = [];
  let stale: Decoration[] = [];
  doc.nodesBetween(from, Math.max(from, to), (node, pos) => {
    if (!isDrawnAt(drawn, pos, node)) {
      stale = stale.concat(drawnAt(drawn, pos, node));
      add.push(Decoration.node(pos, pos + node.nodeSize, {}, SPEC));
    }
    return false;
  });
  if (add.length === 0) return drawn;
  return drawn.remove(stale).add(doc, add);
}

function drawBlock(
  drawn: DecorationSet,
  doc: ProseNode,
  block: { from: number; node: ProseNode } | null,
): DecorationSet {
  if (!block || isDrawnAt(drawn, block.from, block.node)) return drawn;
  return drawRange(drawn, doc, block.from, block.from + block.node.nodeSize);
}

/** The blocks the selection's two ends are in stay drawn, so the caret
 *  always has DOM to sit in; the blocks between them need not. */
function drawSelection(drawn: DecorationSet, state: EditorState) {
  const { $anchor, $head } = state.selection;
  drawn = drawBlock(drawn, state.doc, blockAt($anchor));
  return drawBlock(drawn, state.doc, blockAt($head));
}

/** What a transaction changed, as ranges of the document after it. */
function changedRanges(tr: Transaction): [number, number][] {
  const ranges: [number, number][] = [];
  tr.mapping.maps.forEach((map, i) => {
    const after = tr.mapping.slice(i + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      ranges.push([after.map(newStart, -1), after.map(newEnd, 1)]);
    });
  });
  return ranges;
}

function firstDrawn(state: EditorState): DecorationSet {
  const { doc } = state;
  const at = state.selection.$head.index(0);
  const decorations: Decoration[] = [];
  doc.forEach((node, pos, index) => {
    if (Math.abs(index - at) <= FIRST_DRAWN)
      decorations.push(Decoration.node(pos, pos + node.nodeSize, {}, SPEC));
  });
  return drawSelection(DecorationSet.create(doc, decorations), state);
}

function applyMeta(
  drawn: DecorationSet,
  meta: LazyBlocksMeta,
  tr: Transaction,
): DecorationSet {
  const { doc } = tr;
  // Every block at once (for printing): one set, not one lookup a block.
  if ("drawAll" in meta) {
    const all: Decoration[] = [];
    doc.forEach((node, pos) =>
      all.push(Decoration.node(pos, pos + node.nodeSize, {}, SPEC)),
    );
    return DecorationSet.create(doc, all);
  }
  const blocks = (positions: readonly number[] = []) =>
    positions
      .map((pos) => tr.mapping.map(pos, 1))
      .filter((pos) => pos < doc.content.size)
      .map((pos) => topLevelBlock(doc, pos));
  for (const block of blocks(meta.draw)) drawn = drawBlock(drawn, doc, block);
  const gone = blocks(meta.release).flatMap((b) =>
    drawnAt(drawn, b.from, b.node),
  );
  return gone.length ? drawn.remove(gone) : drawn;
}

/** The blocks drawn in one set and not the other, marked with which. */
function flipsBetween(
  before: DecorationSet,
  after: DecorationSet,
  doc: ProseNode,
): DecorationSet {
  const starts = (set: DecorationSet) => new Set(set.find().map((d) => d.from));
  const was = starts(before);
  const now = starts(after);
  const flips: Decoration[] = [];
  const mark = (from: number, drawn: boolean) => {
    if (from >= doc.content.size) return;
    const block = topLevelBlock(doc, from);
    if (block.from !== from) return;
    const spec: FlipSpec = { lazyBlockFlip: drawn };
    flips.push(Decoration.node(from, from + block.node.nodeSize, {}, spec));
  };
  for (const from of now) if (!was.has(from)) mark(from, true);
  for (const from of was) if (!now.has(from)) mark(from, false);
  return flips.length ? DecorationSet.create(doc, flips) : DecorationSet.empty;
}

function apply(
  tr: Transaction,
  prev: LazyBlocksState,
  state: EditorState,
): LazyBlocksState {
  const active = prev.active
    ? keepsDrawingLazily(state.doc)
    : drawsLazily(state.doc);
  if (!active) return prev.active ? INACTIVE : prev;
  if (!prev.active)
    return { active, drawn: firstDrawn(state), flips: DecorationSet.empty };

  const mapped = tr.docChanged
    ? prev.drawn.map(tr.mapping, tr.doc)
    : prev.drawn;
  let drawn = mapped;
  const meta = tr.getMeta(lazyBlocksKey) as LazyBlocksMeta | undefined;
  if (meta) drawn = applyMeta(drawn, meta, tr);
  // What was just written or pasted is drawn, wherever it lands; of a
  // large change (the file reloaded) only its two ends.
  if (tr.docChanged)
    for (const [from, to] of changedRanges(tr)) {
      if (to - from <= LARGE_CHANGE)
        drawn = drawRange(drawn, state.doc, from, to);
      else
        for (const end of [from, to])
          drawn = drawBlock(drawn, state.doc, blockAt(state.doc.resolve(end)));
    }
  if (tr.docChanged || tr.selectionSet || meta)
    drawn = drawSelection(drawn, state);
  const flips =
    drawn === mapped
      ? DecorationSet.empty
      : flipsBetween(mapped, drawn, state.doc);
  if (drawn === prev.drawn && flips === prev.flips) return prev;
  return { active, drawn, flips };
}

/** Keeps which top-level blocks are drawn; the decorations it provides
 *  mark the blocks that just changed, for the view to draw them anew. */
export function createLazyBlocksPlugin(): Plugin<LazyBlocksState> {
  return new Plugin<LazyBlocksState>({
    key: lazyBlocksKey,
    state: {
      init: (_config, state) =>
        drawsLazily(state.doc)
          ? {
              active: true,
              drawn: firstDrawn(state),
              flips: DecorationSet.empty,
            }
          : INACTIVE,
      apply: (tr, prev, _old, state) => apply(tr, prev, state),
    },
    props: {
      decorations: (state) => lazyBlocksKey.getState(state)?.flips,
    },
  });
}
