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

/**
 * Saving a document writes back, byte for byte, every top-level block the
 * user didn't change, and serializes only the ones they did.
 *
 * The serializer writes remark's house style: `_em_` comes out `*em*`, a
 * setext heading ATX, a table re-padded, `snake_case` escaped. That is fine
 * for the block being edited, but a whole-document serialization wrote that
 * style into every block of the file on its first edit, and someone who
 * also keeps the file in Git saw the whole file change.
 *
 * When the file is opened, each top-level block is paired with the stretch
 * of the file it was read from (its mdast `position`). A save then walks
 * the editor's blocks: ProseMirror keeps an untouched block as the same
 * node object through every edit elsewhere, so a block that is still that
 * object - or one equal to it - is written as its original text, with the
 * original blank lines towards a neighbour that is also untouched. Runs of
 * changed blocks are serialized, and joined to the rest by a blank line.
 *
 * A block written as it was read can still mean something else in new
 * company: two lists that end up next to each other merge, a `---` that
 * becomes the first block opens front matter. So every join that isn't the
 * file's own is read back, and where the blocks on either side don't come
 * back as they are in the editor, those blocks are serialized too. Anything
 * that can't be paired - an mdast node without a position, a block a plugin
 * changed on load - is serialized. When in doubt, serialize: a noisier diff
 * is better than a file that reads differently.
 */

/** One stretch of the opened file and the top-level blocks it was read
 *  into (nearly always one). `start`/`end` are offsets into the file; null
 *  when this stretch can't be written back as it was. */
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
  /** What earlier saves worked out, by the blocks they were about: an edit
   *  touches one block, and the runs changed before it - after a Replace
   *  All, hundreds - are serialized and checked once, not on every save. */
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

/** `text` read the way the editor's parser reads it (ParserState.run:
 *  the root's children in one pass into the doc), noting which blocks
 *  each child became. */
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
 * Keeps the editor's parse of the document it opens (defaultValueCtx), so
 * pairing its blocks with the file's text costs no second parse: on a long
 * document that parse is most of a second. The parser is wrapped once,
 * before the editor state is made from it; every other parse - a paste,
 * an AI edit - goes to the stock parser.
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

/** Each editor's serializations of single blocks, which a block keeps for
 *  as long as it is the same node. */
const blockMarkdowns = new WeakMap<Ctx, WeakMap<ProseNode, string>>();

/** What the serializer writes for one top-level block. */
function blockMarkdown(ctx: Ctx, node: ProseNode): string {
  let known = blockMarkdowns.get(ctx);
  if (!known) blockMarkdowns.set(ctx, (known = new WeakMap()));
  let markdown = known.get(node);
  if (markdown === undefined) {
    const doc = ctx.get(schemaCtx).topNodeType.create(null, node);
    markdown = ctx.get(serializerCtx)(doc);
    known.set(node, markdown);
  }
  return markdown;
}

/** The same block, or one that serializes to the same Markdown: a plugin
 *  that touched an attr on load, or text deleted and typed again. */
function sameBlock(ctx: Ctx, a: ProseNode, b: ProseNode): boolean {
  return a === b || a.eq(b) || blockMarkdown(ctx, a) === blockMarkdown(ctx, b);
}

/** The blocks a parse of `text` gives, in order. */
function readBlocks(ctx: Ctx, text: string): ProseNode[] {
  return parseBlocks(ctx, text).children.flatMap((child) => child.blocks);
}

/**
 * Pairs `doc` - the editor's document as it was opened - with `text`, the
 * Markdown it was opened from. Null when they don't line up block for
 * block (then every save serializes the whole document).
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
  // A construct that became no block of its own (none does today) goes
  // with the unit before it, or else the one after.
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
    byNode.set(nodes[0], units.length);
    units.push({
      nodes,
      start: kept ? Math.min(start, orphanStart ?? start) : null,
      end: kept ? end : null,
    });
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

/** One piece of the output: a stretch of the file's own text (units
 *  `from`..`to`, inclusive), or a run of changed blocks (children `from`
 *  to `to`, exclusive) serialized. */
type Piece =
  | { kind: "kept"; from: number; to: number }
  | { kind: "changed"; from: number; to: number };

/** Which unit each block of `doc` is kept as (at a unit's first block),
 *  or null: the same node objects first, then - between two of those -
 *  blocks standing where as many unclaimed units stood, equal to them. */
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
 *  newline. `offsets` holds each child's position in `doc`. A thematic
 *  break is written "***" only as the document's first block
 *  (markdown-output.ts); first in a run elsewhere, it is "---". */
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

/** Blocks a reference elsewhere needs to read as a link: link and
 *  footnote definitions. A join is read back with them after it. */
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
 * The Markdown to save for `doc`: the file's own text for every block that
 * is as it was opened, the serializer's for the rest. `source` is what
 * readSourceBlocks paired the opened document with.
 */
export function writePreservingSource(
  ctx: Ctx,
  source: SourceBlocks,
  doc: ProseNode,
): string {
  const forced = new Set<number>();
  // Each round serializes the blocks beside a join that didn't read back;
  // a few are enough for any real document. Past them, the whole document.
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
        definitions.push(unitText(source, u));
    return text.slice(units[piece.from].start!, units[piece.to].end!);
  });
  const first = pieces[0];
  const last = pieces.at(-1)!;
  // Before the first block and after the last: the file's own, while the
  // block there is the file's first or last as it was.
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

/** The units on either side of each join the file didn't have, whose
 *  blocks don't read back as the editor holds them. */
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
  /** What changed run `p` should read back as: what the serializer's text
   *  for it reads as on its own. That isn't always the editor's blocks
   *  exactly, which is the serializer's business, not this check's. */
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
  /** The end of piece `p` that meets a join: its unit, or the whole run;
   *  `edge` is its block right at the join. */
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
  /** Whether a join reads back, from an earlier save when the same text
   *  met there. */
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
  // The first block, when it isn't the file's first: a "---" there opens
  // front matter, which runs to the next "---" however far down - more
  // than a join's neighbours can show. Such a block is serialized
  // (thematicBreak writes the first block's rule "***").
  const first = pieces[0];
  if (
    first.kind === "kept" &&
    first.from !== 0 &&
    /^(?:---|\+\+\+)/.test(unitText(source, first.from))
  )
    failed.push(first.from);
  for (let p = 1; p < pieces.length; p++) {
    const left = side(p - 1, "last");
    const right = side(p, "first");
    if (joinReads(left, right)) continue;
    if (left.unit !== null) failed.push(left.unit);
    if (right.unit !== null) failed.push(right.unit);
  }
  return failed;
}
