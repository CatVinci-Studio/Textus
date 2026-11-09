import {
  ParserReady,
  defaultValueCtx,
  editorStateTimerCtx,
  parserCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import { createTimer, type Ctx, type MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  openedParseCtx,
  parseBlocks,
  sameBlock,
  type Piece,
  type SourceBlocks,
  type SourceUnit,
} from "./source-parts";
import { compose, checkJoins } from "./source-compose";

/**
 * Saving writes back, byte for byte, every top-level block the user didn't
 * change, and serializes only the ones they did, so remark's house style
 * never rewrites a whole file. Each block is paired on open with the stretch
 * of the file it was read from; every new join is read back, and where it
 * reads differently (two lists merging) the blocks around it are serialized
 * too. When in doubt, serialize.
 */

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
