import { remarkCtx, schemaCtx } from "@milkdown/kit/core";
import { createSlice, type Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { ParserState, type MarkdownNode } from "@milkdown/kit/transformer";
import { blockMarkdown } from "./block-markdown";

/** A file's blocks as it was opened, and reading Markdown back into blocks:
 *  what saving with its own text compares against. */

/** One stretch of the opened file and the top-level blocks it was read into.
 *  `start`/`end` are file offsets; null when it can't be written back. */
export interface SourceUnit {
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

/** A parse that knows which top-level blocks each child of the mdast root
 *  became, and where in the text that child was. */
export interface BlockParse {
  text: string;
  doc: ProseNode;
  /** Per root child: its offsets (null without a position) and blocks. */
  children: { start: number | null; end: number | null; blocks: ProseNode[] }[];
}

/** `text` read the way the editor's parser reads it, noting which blocks
 *  each root child became. */
export function parseBlocks(ctx: Ctx, text: string): BlockParse {
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
export const openedParseCtx = createSlice<BlockParse | null>(
  null,
  "openedParse",
);

/** The same block, or one that serializes to the same Markdown. */
export function sameBlock(ctx: Ctx, a: ProseNode, b: ProseNode): boolean {
  return a === b || a.eq(b) || blockMarkdown(ctx, a) === blockMarkdown(ctx, b);
}

/** The blocks a parse of `text` gives, in order. */
export function readBlocks(ctx: Ctx, text: string): ProseNode[] {
  return parseBlocks(ctx, text).children.flatMap((child) => child.blocks);
}

/** One piece of the output: a stretch of the file's text (units `from`..`to`,
 *  inclusive), or a run of changed blocks (children `from`..`to`, exclusive). */
export type Piece =
  | { kind: "kept"; from: number; to: number }
  | { kind: "changed"; from: number; to: number };

export interface SaveMemo {
  /** A changed run's text, by its first block. */
  runs: WeakMap<ProseNode, { nodes: ProseNode[]; text: string }>;
  /** Whether a join read back, by the blocks on either side of it. */
  joins: WeakMap<ProseNode, WeakMap<ProseNode, JoinCheck>>;
}

export interface Positioned {
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

export interface JoinCheck {
  left: string;
  right: string;
  definitions: string;
  ok: boolean;
}
