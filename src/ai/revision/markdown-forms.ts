import { isPicture } from "../doc-blocks";
import { markdownBlockKind } from "./block-reader";

/** The Markdown forms a revision is compared and found by: the editor and
 *  the model write the same thing differently (`***` vs `---`). */

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

/** The kind of `block` when a rewrite changes it whole rather than by
 *  sentence; null for prose. An `<img>` is a picture given a width. */
export function wholeBlockKind(block: string): WholeBlockKind | null {
  const text = block.trim();
  if (!text) return null;
  const kind = markdownBlockKind(text);
  if (kind === "html" && isPicture(text)) return "picture";
  return kind && WHOLE.has(kind) ? (kind as WholeBlockKind) : null;
}

/** A comparison key, the same for two ways of writing one thing. Backslash
 *  escapes go too: the editor escapes `\*`, a model writes it bare. */
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

/** `markdown` as its text shows in the document: footnote marks and link
 *  references show no text there. */
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

/** What a card says for a whole-block change, as inline Markdown: a table
 *  or picture by its kind. Null for prose. */
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
