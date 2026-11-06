import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { gfm } from "micromark-extension-gfm";
import { math } from "micromark-extension-math";
import { frontmatter } from "micromark-extension-frontmatter";
import type { RootContent } from "mdast";
import { blockIds, type BlockKind } from "../../ai/doc-blocks";

/**
 * A document's blocks as they sit in its text, for plugins that change it
 * before it is saved, and the way their answer is written back: only the
 * blocks they changed, each keeping its line endings, and never inside
 * code, math, HTML or a link definition.
 */

export interface TextBlock {
  id: string;
  kind: BlockKind;
  markdown: string;
  /** Offsets into the text. */
  from: number;
  to: number;
}

export interface BlockEdit {
  block: string;
  markdown: string;
}

/** What a plugin may not change: the user's code, math, HTML and links. */
const KEPT: ReadonlySet<BlockKind> = new Set([
  "code",
  "math",
  "html",
  "definition",
]);

const KINDS: Partial<Record<RootContent["type"], BlockKind>> = {
  paragraph: "paragraph",
  heading: "heading",
  list: "list",
  blockquote: "quote",
  code: "code",
  math: "math",
  table: "table",
  thematicBreak: "rule",
  html: "html",
  footnoteDefinition: "footnote",
  definition: "definition",
};

function kindOf(node: RootContent): BlockKind {
  const kind = KINDS[node.type] ?? "other";
  if (node.type !== "paragraph") return kind;
  const own = node.children.filter(
    (child) => child.type !== "text" || child.value.trim(),
  );
  return own.length > 0 && own.every((child) => child.type === "image")
    ? "picture"
    : kind;
}

/** `text`'s top-level blocks, in order. */
export function textBlocks(text: string): TextBlock[] {
  const tree = fromMarkdown(text, {
    extensions: [gfm(), math(), frontmatter()],
    mdastExtensions: [
      gfmFromMarkdown(),
      mathFromMarkdown(),
      frontmatterFromMarkdown(),
    ],
  });
  const spans = tree.children.flatMap((node) => {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    return from === undefined || to === undefined
      ? []
      : [{ kind: kindOf(node), from, to, markdown: text.slice(from, to) }];
  });
  const ids = blockIds(spans.map((s) => s.markdown));
  return spans.map((span, i) => ({ id: ids[i], ...span }));
}

const lf = (text: string) => text.replace(/\r\n/g, "\n");

/** `markdown` with the block's line ending, CRLF or LF; a one-line block
 *  takes the document's. */
function endingsOf(block: string, text: string, markdown: string): string {
  const like = block.includes("\n") ? block : text;
  return like.includes("\r\n")
    ? lf(markdown).replace(/\n/g, "\r\n")
    : lf(markdown);
}

/** `text` with `edits` made, each in its block; an edit of a kept block or
 *  an unknown one is left out, and `dropped` hears why. */
export function applyBlockEdits(
  text: string,
  blocks: readonly TextBlock[],
  edits: readonly BlockEdit[],
  dropped: (why: string) => void = () => {},
): string {
  let out = text;
  const byId = new Map(edits.map((edit) => [edit.block, edit.markdown]));
  for (const block of [...blocks].reverse()) {
    const markdown = byId.get(block.id);
    if (markdown === undefined || lf(markdown) === lf(block.markdown)) continue;
    if (KEPT.has(block.kind)) {
      dropped(`a ${block.kind} block is the user's to change`);
      continue;
    }
    out =
      out.slice(0, block.from) +
      endingsOf(block.markdown, text, markdown) +
      out.slice(block.to);
  }
  return out;
}

/** What to save of a plugin's whole new text: block by block where the
 *  blocks still line up, else the one changed stretch, unless it reaches
 *  into a kept block. */
export function mergeWholeText(
  text: string,
  next: string,
  dropped: (why: string) => void = () => {},
): string {
  if (lf(next) === lf(text)) return text;
  const before = textBlocks(text);
  const after = textBlocks(next);
  if (before.length === after.length)
    return applyBlockEdits(
      text,
      before,
      before.map((block, i) => ({
        block: block.id,
        markdown: after[i].markdown,
      })),
      dropped,
    );
  let start = 0;
  while (start < text.length && text[start] === next[start]) start++;
  let end = 0;
  while (
    end < text.length - start &&
    end < next.length - start &&
    text[text.length - 1 - end] === next[next.length - 1 - end]
  )
    end++;
  const reaches = before.some(
    (block) =>
      KEPT.has(block.kind) &&
      block.from < text.length - end &&
      block.to > start,
  );
  if (reaches) {
    dropped(`the change reaches into a block that is the user's to change`);
    return text;
  }
  return next;
}
