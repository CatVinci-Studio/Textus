import { serializerCtx } from "@milkdown/kit/core";
import { type Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { withEscapesAsWritten } from "./escapes-as-written";
import {
  readBlocks,
  sameBlock,
  type Piece,
  type SaveMemo,
  type SourceBlocks,
} from "./source-parts";

/** Saving with the file's own text: kept pieces and changed runs put back
 *  together, and each join checked to read back as the document has it. */

/** A run of changed blocks as the serializer writes it, without the final
 *  newline, with `original`'s escapes where they still read the same. A
 *  thematic break first in a run (not the document) is "---". */
export function writeRun(
  ctx: Ctx,
  { runs }: SaveMemo,
  doc: ProseNode,
  offsets: number[],
  from: number,
  to: number,
  original: string | null,
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
    if (original !== null && original.length < MAX_ESCAPE_CHECK) {
      const kept = withEscapesAsWritten(original, text);
      if (kept !== text && sameNodes(ctx, nodes, readBlocks(ctx, kept)))
        text = kept;
    }
    runs.set(nodes[0], { nodes, text });
  }
  return from > 0 && nodes[0].type.name === "hr"
    ? text.replace(/^\*\*\*/, "---")
    : text;
}

/** Longer stretches are a rewrite: their escapes aren't worth a diff. */
export const MAX_ESCAPE_CHECK = 20_000;

export function sameObjects(a: readonly ProseNode[], b: readonly ProseNode[]) {
  return a.length === b.length && a.every((node, k) => node === b[k]);
}

/** Link and footnote definitions, which a join is read back with. */
export function isDefinition(node: ProseNode): boolean {
  if (node.type.name === "footnote_definition") return true;
  return (
    node.type.name === "paragraph" &&
    node.childCount === 1 &&
    node.firstChild!.type.name === "link_definition"
  );
}

export function sameNodes(
  ctx: Ctx,
  a: readonly ProseNode[],
  b: readonly ProseNode[],
): boolean {
  return (
    a.length === b.length && a.every((node, k) => sameBlock(ctx, node, b[k]))
  );
}

export interface Composed {
  text: string;
  /** Each piece's text, and for a changed run its serialization. */
  pieceTexts: string[];
  /** The definitions' text, read back after each join. */
  definitions: string;
}

/** The file's text a changed run stands in for: between the kept pieces
 *  around it, when they are in the file's order. */
export function originalBetween(
  { text, units }: SourceBlocks,
  before: Piece | undefined,
  after: Piece | undefined,
): string | null {
  const from = before ? units[before.to].end! : 0;
  const to = after ? units[after.from].start! : text.length;
  return from <= to ? text.slice(from, to).trim() : null;
}

export function unitText(source: SourceBlocks, u: number): string {
  const unit = source.units[u];
  return source.text.slice(unit.start!, unit.end!);
}

export function compose(
  ctx: Ctx,
  source: SourceBlocks,
  doc: ProseNode,
  pieces: Piece[],
): Composed {
  const { text, units } = source;
  const offsets: number[] = [];
  doc.forEach((_node, offset) => offsets.push(offset));
  const definitions: string[] = [];
  const pieceTexts = pieces.map((piece, p) => {
    if (piece.kind === "changed") {
      const written = writeRun(
        ctx,
        source.memo,
        doc,
        offsets,
        piece.from,
        piece.to,
        originalBetween(source, pieces[p - 1], pieces[p + 1]),
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
export function checkJoins(
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
