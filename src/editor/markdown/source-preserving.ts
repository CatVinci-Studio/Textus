import {
  ParserReady,
  defaultValueCtx,
  editorStateTimerCtx,
  parserCtx,
  remarkCtx,
  schemaCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import {
  createSlice,
  createTimer,
  type Ctx,
  type MilkdownPlugin,
} from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { ParserState, type MarkdownNode } from "@milkdown/kit/transformer";
import { blockMarkdown } from "./block-markdown";

/**
 * Saving writes back, byte for byte, every top-level block the user didn't
 * change, and serializes only the ones they did, so remark's house style
 * never rewrites a whole file. Each block is paired on open with the stretch
 * of the file it was read from; every new join is read back, and where it
 * reads differently (two lists merging) the blocks around it are serialized
 * too. When in doubt, serialize.
 */

/** One stretch of the opened file and the top-level blocks it was read into.
 *  `start`/`end` are file offsets; null when it can't be written back. */
interface SourceUnit {
  nodes: readonly ProseNode[];
  start: number | null;
  end: number | null;
}

/** The opened file, split into the stretches its blocks came from. */
export interface SourceBlocks {
  text: string;
  units: SourceUnit[];
  /** Each unit's first block, to its unit's index. */
  byNode: Map<ProseNode, number>;
  /** What earlier saves worked out, by the blocks they were about, so runs
   *  changed before (after a Replace All, hundreds) are checked only once. */
  memo: SaveMemo;
}

interface SaveMemo {
  /** A changed run's text, by its first block. */
  runs: WeakMap<ProseNode, { nodes: ProseNode[]; text: string }>;
  /** Whether a join read back, by the blocks on either side of it. */
  joins: WeakMap<ProseNode, WeakMap<ProseNode, JoinCheck>>;
}

interface JoinCheck {
  left: string;
  right: string;
  definitions: string;
  ok: boolean;
}

interface Positioned {
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

/** A parse that knows which top-level blocks each child of the mdast root
 *  became, and where in the text that child was. */
interface BlockParse {
  text: string;
  doc: ProseNode;
  /** Per root child: its offsets (null without a position) and blocks. */
  children: { start: number | null; end: number | null; blocks: ProseNode[] }[];
}

/** `text` read the way the editor's parser reads it, noting which blocks
 *  each root child became. */
function parseBlocks(ctx: Ctx, text: string): BlockParse {
  const remark = ctx.get(remarkCtx);
  const schema = ctx.get(schemaCtx);
  const tree = remark.runSync(remark.parse(text), text) as MarkdownNode;
  const state = new ParserState(schema);
  state.openNode(schema.topNodeType);
  const top = state.top()!;
  const children = ((tree.children ?? []) as MarkdownNode[]).map((child) => {
    const before = top.content.length;
    state.next(child);
    const { position } = child as Positioned;
    return {
      start: position?.start?.offset ?? null,
      end: position?.end?.offset ?? null,
      blocks: top.content.slice(before),
    };
  });
  return { text, doc: state.toDoc(), children };
}

/** The editor's own parse of the text it opened with. */
const openedParseCtx = createSlice<BlockParse | null>(null, "openedParse");
const OpenedParseRecorded = createTimer("OpenedParseRecorded");

/**
 * Keeps the editor's parse of the document it opens, so pairing its blocks
 * with the file costs no second parse (most of a second on a long one).
 * Every other parse goes to the stock parser.
 */
export const openedParseRecorder: MilkdownPlugin = (ctx) => {
  ctx.inject(openedParseCtx, null).record(OpenedParseRecorded);
  ctx.update(editorStateTimerCtx, (timers) =>
    timers.concat(OpenedParseRecorded),
  );
  return async () => {
    await ctx.wait(ParserReady);
    const parse = ctx.get(parserCtx);
    ctx.set(parserCtx, (text) => {
      if (ctx.get(openedParseCtx) || text !== ctx.get(defaultValueCtx))
        return parse(text);
      const opened = parseBlocks(ctx, text);
      ctx.set(openedParseCtx, opened);
      return opened.doc;
    });
    ctx.done(OpenedParseRecorded);
    return () => {
      ctx.remove(openedParseCtx).clearTimer(OpenedParseRecorded);
    };
  };
};

/** The same block, or one that serializes to the same Markdown. */
function sameBlock(ctx: Ctx, a: ProseNode, b: ProseNode): boolean {
  return a === b || a.eq(b) || blockMarkdown(ctx, a) === blockMarkdown(ctx, b);
}

/** The blocks a parse of `text` gives, in order. */
function readBlocks(ctx: Ctx, text: string): ProseNode[] {
  return parseBlocks(ctx, text).children.flatMap((child) => child.blocks);
}

/**
 * Pairs `doc`, the editor's document as opened, with `text`, the Markdown it
 * came from. Null when they don't line up block for block.
 */
export function readSourceBlocks(
  ctx: Ctx,
  text: string,
  doc: ProseNode,
): SourceBlocks | null {
  const recorded = ctx.get(openedParseCtx);
  const { children } =
    recorded?.text === text ? recorded : parseBlocks(ctx, text);
  const count = children.reduce((sum, child) => sum + child.blocks.length, 0);
  if (count !== doc.childCount) return null;
  const units: SourceUnit[] = [];
  const byNode = new Map<ProseNode, number>();
  // A construct that became no block of its own goes with the unit before it,
  // or else the one after.
  let orphanStart: number | null = null;
  let index = 0;
  for (const { start, end, blocks } of children) {
    if (blocks.length === 0) {
      const last = units.at(-1);
      if (last && last.end !== null && end !== null) last.end = end;
      else orphanStart ??= start;
      continue;
    }
    const nodes = blocks.map((_, k) => doc.child(index + k));
    const kept =
      start !== null &&
      end !== null &&
      blocks.every((node, k) => sameBlock(ctx, node, nodes[k]));
    // A setext heading under a definition starts where the definition does:
    // its stretch begins after the one before.
    let from = kept ? Math.min(start, orphanStart ?? start) : null;
    const previousEnd = units.at(-1)?.end ?? null;
    if (from !== null && previousEnd !== null && from < previousEnd) {
      from = previousEnd;
      while (text[from] === "\n") from++;
    }
    // From the start of its line: without the space before ` -    one`, the
    // indented code under it would join the list item.
    if (from !== null) {
      let lineStart = from;
      while (
        lineStart > (previousEnd ?? 0) &&
        /[ \t]/.test(text[lineStart - 1])
      )
        lineStart--;
      if (lineStart === 0 || text[lineStart - 1] === "\n") from = lineStart;
    }
    byNode.set(nodes[0], units.length);
    units.push({ nodes, start: from, end: kept ? end : null });
    orphanStart = null;
    index += blocks.length;
  }
  return {
    text,
    units,
    byNode,
    memo: { runs: new WeakMap(), joins: new WeakMap() },
  };
}

/** One piece of the output: a stretch of the file's text (units `from`..`to`,
 *  inclusive), or a run of changed blocks (children `from`..`to`, exclusive). */
type Piece =
  | { kind: "kept"; from: number; to: number }
  | { kind: "changed"; from: number; to: number };

/** Which unit each block of `doc` is kept as, or null: the same node objects
 *  first, then equal blocks standing where as many unclaimed units stood. */
function matchUnits(
  ctx: Ctx,
  source: SourceBlocks,
  doc: ProseNode,
  forced: ReadonlySet<number>,
): (number | null)[] {
  const { units, byNode } = source;
  const count = doc.childCount;
  const unitAt: (number | null)[] = new Array(count).fill(null);
  const claimed = new Set<number>();
  const writable = (u: number) => !forced.has(u) && units[u].start !== null;
  // The kept blocks in order: [child index, unit index].
  const anchors: [number, number][] = [];
  for (let j = 0; j < count; j++) {
    const u = byNode.get(doc.child(j));
    if (u === undefined || !writable(u)) continue;
    const { nodes } = units[u];
    if (j + nodes.length > count) continue;
    if (!nodes.every((node, k) => doc.child(j + k) === node)) continue;
    unitAt[j] = u;
    claimed.add(u);
    anchors.push([j, u]);
    j += nodes.length - 1;
  }
  let prevEnd = 0;
  let prevUnit = -1;
  for (const [j, u] of [
    ...anchors,
    [count, units.length] as [number, number],
  ]) {
    if (u > prevUnit + 1 && j > prevEnd) {
      const free: number[] = [];
      for (let f = prevUnit + 1; f < u; f++) if (!claimed.has(f)) free.push(f);
      const size = free.reduce((n, f) => n + units[f].nodes.length, 0);
      if (size === j - prevEnd) {
        let at = prevEnd;
        for (const f of free) {
          const { nodes } = units[f];
          if (
            writable(f) &&
            nodes.every((node, k) => sameBlock(ctx, doc.child(at + k), node))
          ) {
            unitAt[at] = f;
            claimed.add(f);
          }
          at += nodes.length;
        }
      }
    }
    if (j < count) {
      prevEnd = j + units[u].nodes.length;
      prevUnit = Math.max(prevUnit, u);
    }
  }
  return unitAt;
}

/** The output in pieces, given which blocks are kept. */
function piecesOf(
  source: SourceBlocks,
  doc: ProseNode,
  unitAt: (number | null)[],
): Piece[] {
  const pieces: Piece[] = [];
  for (let j = 0; j < doc.childCount;) {
    const u = unitAt[j];
    const last = pieces.at(-1);
    if (u === null) {
      if (last?.kind === "changed") last.to = j + 1;
      else pieces.push({ kind: "changed", from: j, to: j + 1 });
      j++;
      continue;
    }
    if (last?.kind === "kept" && last.to === u - 1) last.to = u;
    else pieces.push({ kind: "kept", from: u, to: u });
    j += source.units[u].nodes.length;
  }
  return pieces;
}

/** A run of changed blocks as the serializer writes it, without the final
 *  newline. A thematic break first in a run (not the document) is "---". */
function writeRun(
  ctx: Ctx,
  { runs }: SaveMemo,
  doc: ProseNode,
  offsets: number[],
  from: number,
  to: number,
): string {
  const nodes: ProseNode[] = [];
  for (let j = from; j < to; j++) nodes.push(doc.child(j));
  const known = runs.get(nodes[0]);
  let text: string;
  if (known && sameObjects(known.nodes, nodes)) text = known.text;
  else {
    const end = to < doc.childCount ? offsets[to] : doc.content.size;
    text = ctx
      .get(serializerCtx)(doc.cut(offsets[from], end))
      .replace(/\n+$/, "");
    runs.set(nodes[0], { nodes, text });
  }
  return from > 0 && nodes[0].type.name === "hr"
    ? text.replace(/^\*\*\*/, "---")
    : text;
}

function sameObjects(a: readonly ProseNode[], b: readonly ProseNode[]) {
  return a.length === b.length && a.every((node, k) => node === b[k]);
}

/** Link and footnote definitions, which a join is read back with. */
function isDefinition(node: ProseNode): boolean {
  if (node.type.name === "footnote_definition") return true;
  return (
    node.type.name === "paragraph" &&
    node.childCount === 1 &&
    node.firstChild!.type.name === "link_definition"
  );
}

function sameNodes(
  ctx: Ctx,
  a: readonly ProseNode[],
  b: readonly ProseNode[],
): boolean {
  return (
    a.length === b.length && a.every((node, k) => sameBlock(ctx, node, b[k]))
  );
}

/**
 * The Markdown to save for `doc`: the file's own text for every block as it
 * was opened, the serializer's for the rest.
 */
export function writePreservingSource(
  ctx: Ctx,
  source: SourceBlocks,
  doc: ProseNode,
): string {
  const forced = new Set<number>();
  // Each round serializes the blocks beside a join that didn't read back; past
  // a few, the whole document.
  for (let round = 0; round < 6; round++) {
    const unitAt = matchUnits(ctx, source, doc, forced);
    const pieces = piecesOf(source, doc, unitAt);
    const result = compose(ctx, source, doc, pieces);
    const failed = checkJoins(ctx, source, doc, pieces, result);
    if (failed.length === 0) return result.text;
    let grew = false;
    for (const u of failed)
      if (!forced.has(u)) {
        forced.add(u);
        grew = true;
      }
    if (!grew) break;
  }
  return ctx.get(serializerCtx)(doc);
}

interface Composed {
  text: string;
  /** Each piece's text, and for a changed run its serialization. */
  pieceTexts: string[];
  /** The definitions' text, read back after each join. */
  definitions: string;
}

function unitText(source: SourceBlocks, u: number): string {
  const unit = source.units[u];
  return source.text.slice(unit.start!, unit.end!);
}

function compose(
  ctx: Ctx,
  source: SourceBlocks,
  doc: ProseNode,
  pieces: Piece[],
): Composed {
  const { text, units } = source;
  const offsets: number[] = [];
  doc.forEach((_node, offset) => offsets.push(offset));
  const definitions: string[] = [];
  const pieceTexts = pieces.map((piece) => {
    if (piece.kind === "changed") {
      const written = writeRun(
        ctx,
        source.memo,
        doc,
        offsets,
        piece.from,
        piece.to,
      );
      for (let j = piece.from; j < piece.to; j++)
        if (isDefinition(doc.child(j))) {
          definitions.push(written);
          break;
        }
      return written;
    }
    for (let u = piece.from; u <= piece.to; u++)
      if (units[u].nodes.some(isDefinition))
        // Without its indent: after a list, an indented `  [ref]: url` would be part
        // of the list's last item.
        definitions.push(unitText(source, u).trimStart());
    return text.slice(units[piece.from].start!, units[piece.to].end!);
  });
  const first = pieces[0];
  const last = pieces.at(-1)!;
  // Before the first block and after the last: the file's own, while the block
  // there is the file's first or last as it was.
  const head =
    first.kind === "kept" && first.from === 0
      ? text.slice(0, units[0].start!)
      : "";
  const tail =
    last.kind === "kept" && last.to === units.length - 1
      ? text.slice(units[last.to].end!)
      : text === "" || text.endsWith("\n")
        ? "\n"
        : "";
  return {
    // An empty paragraph writes nothing, and no blank line around it.
    text: head + pieceTexts.filter(Boolean).join("\n\n") + tail,
    pieceTexts,
    definitions: definitions.join("\n\n"),
  };
}

/** The units on either side of each new join whose blocks don't read back
 *  as the editor holds them. */
function checkJoins(
  ctx: Ctx,
  source: SourceBlocks,
  doc: ProseNode,
  pieces: Piece[],
  { pieceTexts, definitions }: Composed,
): number[] {
  const { units } = source;
  const suffix = definitions ? `\n\n${definitions}` : "";
  let counted: number | null = null;
  const definitionCount = () =>
    (counted ??= definitions ? readBlocks(ctx, definitions).length : 0);
  /** What changed run `p` should read back as: what its serialized text reads
   *  as on its own. */
  const runs = new Map<number, readonly ProseNode[]>();
  const runNodes = (p: number, from: number, to: number) => {
    const known = runs.get(p);
    if (known) return known;
    const own: ProseNode[] = [];
    for (let j = from; j < to; j++) own.push(doc.child(j));
    const read = readBlocks(ctx, pieceTexts[p] + suffix);
    const alone = read.slice(0, read.length - definitionCount());
    const nodes = sameNodes(ctx, own, alone) ? own : alone;
    runs.set(p, nodes);
    return nodes;
  };
  /** The end of piece `p` that meets a join; `edge` is its block there. */
  const side = (p: number, end: "first" | "last") => {
    const piece = pieces[p];
    if (piece.kind === "changed") {
      const edge = doc.child(end === "first" ? piece.from : piece.to - 1);
      const nodes = () => runNodes(p, piece.from, piece.to);
      return { text: pieceTexts[p], nodes, unit: null, edge };
    }
    const u = end === "first" ? piece.from : piece.to;
    const { nodes } = units[u];
    const edge = end === "first" ? nodes[0] : nodes[nodes.length - 1];
    return { text: unitText(source, u), nodes: () => nodes, unit: u, edge };
  };
  /** Whether a join reads back, from an earlier save when the same text met. */
  const { joins } = source.memo;
  const joinReads = (
    left: ReturnType<typeof side>,
    right: ReturnType<typeof side>,
  ) => {
    const known = joins.get(left.edge)?.get(right.edge);
    if (
      known &&
      known.left === left.text &&
      known.right === right.text &&
      known.definitions === definitions
    )
      return known.ok;
    const ok = readsAs(`${left.text}\n\n${right.text}`, [
      ...left.nodes(),
      ...right.nodes(),
    ]);
    let byRight = joins.get(left.edge);
    if (!byRight) joins.set(left.edge, (byRight = new WeakMap()));
    byRight.set(right.edge, {
      left: left.text,
      right: right.text,
      definitions,
      ok,
    });
    return ok;
  };
  const readsAs = (text: string, nodes: readonly ProseNode[]) => {
    const read = readBlocks(ctx, text + suffix);
    return (
      read.length === nodes.length + definitionCount() &&
      nodes.every((node, k) => sameBlock(ctx, node, read[k]))
    );
  };
  const failed: number[] = [];
  // A run of empty paragraphs writes nothing; the blocks around it meet.
  const shown = pieces.flatMap((_, p) => (pieceTexts[p] ? [p] : []));
  if (shown.length === 0) return failed;
  // A first block that isn't the file's first: a "---" there opens front
  // matter, running further than a join's neighbours show, so serialize it.
  const first = pieces[shown[0]];
  if (
    first.kind === "kept" &&
    first.from !== 0 &&
    /^(?:---|\+\+\+)/.test(unitText(source, first.from))
  )
    failed.push(first.from);
  for (let k = 1; k < shown.length; k++) {
    const left = side(shown[k - 1], "last");
    const right = side(shown[k], "first");
    if (joinReads(left, right)) continue;
    if (left.unit !== null) failed.push(left.unit);
    if (right.unit !== null) failed.push(right.unit);
  }
  return failed;
}
