import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { ParserReady, parserCtx } from "@milkdown/kit/core";
import { normalizeMathDelimiters } from "../../utils/markdown-math";
import { blockKind, type BlockKind } from "../doc-blocks";

/** What kind of block a piece of Markdown is, read by the editor's own
 *  parser so model text and document are told apart the same way. */

let read: ((markdown: string) => BlockKind | null) | null = null;
/** Kinds read so far: a rewrite's sentences are read again on every
 *  streamed fragment, each the same as the last time but the newest. */
const seen = new Map<string, BlockKind | null>();
const SEEN_LIMIT = 2000;

/** The kind of block `markdown` is when it is one block; null for several,
 *  none, or no registered parser (as in the detached chat window). */
export function markdownBlockKind(markdown: string): BlockKind | null {
  if (!read) return null;
  const known = seen.get(markdown);
  if (known !== undefined) return known;
  const kind = read(markdown);
  if (seen.size >= SEEN_LIMIT) seen.clear();
  seen.set(markdown, kind);
  return kind;
}

/** Registers the editor's parser for markdownBlockKind. */
export const blockReader: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(ParserReady);
  const parse = ctx.get(parserCtx);
  read = (markdown) => {
    try {
      const doc = parse(normalizeMathDelimiters(markdown));
      return doc.childCount === 1 ? blockKind(doc.firstChild!) : null;
    } catch {
      return null;
    }
  };
  seen.clear();
};
