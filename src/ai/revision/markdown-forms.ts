import { isPicture } from "../doc-blocks";
import { markdownBlockKind } from "./block-reader";

/**
 * The Markdown a revision is compared and found by, in one place: which
 * blocks are changed whole rather than sentence by sentence, when two
 * ways of writing a thing are the same thing, and what a piece's text is
 * in the document - where Markdown marks show nothing.
 *
 * A rewrite is diffed as Markdown (sentence-diff.ts) and found in the
 * document as rendered text (sentence-locate.ts). The document reaches the
 * model as the editor writes it (`<https://…>`, `***`, padded tables) and
 * comes back as the model writes it (`https://…`, `---`, `|a|b|`); a mark
 * like a footnote's `[^1]` is a node with no text. Each difference left
 * out here made a rewrite of a whole document one block and one card, or
 * a change of nothing (rc.6).
 */

export { isPicture };

/** Every picture inside a text, with its description and address (an
 *  address in `<>` keeps its brackets). */
export const PICTURES_IN_TEXT =
  /!\[([^\]]*)\]\((<[^>]*>|[^)\s]*)(?:\s+"[^"]*")?\)/g;

/** The kinds of block a rewrite changes whole (wholeBlockKind). */
export type WholeBlockKind =
  | "picture"
  | "rule"
  | "table"
  | "code"
  | "math"
  | "footnote"
  | "definition"
  | "html";

const WHOLE = new Set<string>([
  "picture",
  "rule",
  "table",
  "code",
  "math",
  "footnote",
  "definition",
  "html",
]);

/**
 * What kind of block `block` (one block of text) is, when it is one a
 * rewrite changes whole rather than by sentence: a picture, a table, a
 * code or maths block, a footnote's or a link's definition, a rule, an
 * HTML block - as the editor's parser reads it (block-reader.ts), the
 * reading the document's own blocks have. Null for prose (a paragraph, a
 * heading, a list, a quote). An `<img>` is a picture given a width.
 */
export function wholeBlockKind(block: string): WholeBlockKind | null {
  const text = block.trim();
  if (!text) return null;
  const kind = markdownBlockKind(text);
  if (kind === "html" && isPicture(text)) return "picture";
  return kind && WHOLE.has(kind) ? (kind as WholeBlockKind) : null;
}

/**
 * A sentence or block as it is compared: two that differ only in how the
 * same thing is written have the same key - an autolink's brackets, a
 * rule's characters, a table's padding and its dashes.
 *
 * Every backslash escape is dropped too, on purpose: the editor escapes a
 * `*` or `_` it writes as text (`\*`), and a model writing the same
 * sentence back leaves it bare. The two read alike; only the key forgets
 * the difference - the text applied is the model's, as written.
 */
export function formKey(markdown: string): string {
  const text = markdown.trim();
  const kind = wholeBlockKind(text);
  if (kind === "rule") return "***";
  const unwritten = text
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!~|<>])/g, "$1");
  if (kind !== "table") return unwritten;
  return unwritten
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/\s*\|\s*/g, "|")
        .replace(/:?-{3,}:?/g, (m) => m.replace(/-+/, "---")),
    )
    .join("\n");
}

/**
 * `markdown` as its text shows in the document, for finding it there: a
 * footnote's mark is a node with no text, and a reference link shows its
 * words without the reference (parsed alone, with no definition, both
 * were kept as written and never found).
 */
export function matchableMarkdown(markdown: string): string {
  return markdown
    .replace(/\[\^[^\]\s]+\](?!:)/g, "")
    .replace(/!\[[^\]\n]*\]\[[^\]\n]*\]/g, "")
    .replace(/\[([^\]\n]+)\]\[[^\]\n]*\]/g, "$1");
}

/** What a change of a whole block is called on a card, by its kind. */
export type BlockNames = Record<
  "picture" | "table" | "code" | "math" | "other",
  string
>;

/** The names, from the strings (the chat's and the margin's cards). */
export function blockNames(t: {
  proposalBlockPicture: string;
  proposalBlockTable: string;
  proposalBlockCode: string;
  proposalBlockMath: string;
  proposalBlockOther: string;
}): BlockNames {
  return {
    picture: t.proposalBlockPicture,
    table: t.proposalBlockTable,
    code: t.proposalBlockCode,
    math: t.proposalBlockMath,
    other: t.proposalBlockOther,
  };
}

/**
 * What a card says for a change of a whole block, `markdown`, as Markdown
 * to draw inline: a table or a picture isn't drawn whole in a line of a
 * card, its kind (and a picture's description) is; a footnote's definition
 * is its raised label and its words. Null for prose, which is its text.
 */
export function blockSummary(
  markdown: string,
  names: BlockNames,
): string | null {
  const text = markdown.trim();
  switch (wholeBlockKind(text)) {
    case null:
      return null;
    case "picture": {
      const alt =
        text.match(/^!\[([^\]]*)\]/)?.[1] ?? text.match(/alt="([^"]*)"/)?.[1];
      return alt ? `${names.picture}: ${alt}` : names.picture;
    }
    case "table":
      return names.table;
    case "code":
      return names.code;
    case "math":
      return names.math;
    case "footnote":
      return text.replace(/^(\[\^[^\]\s]+\]):[ \t]*/, "$1 ");
    default:
      return names.other;
  }
}
