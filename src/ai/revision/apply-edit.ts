import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { Ctx } from "@milkdown/kit/ctx";
import {
  Fragment,
  Slice,
  type Node as ProseNode,
} from "@milkdown/kit/prose/model";
import { parseMarkdownSource } from "../../editor/markdown/parse-markdown-source";

/** Models often bullet lists with "•" and the like, which Markdown keeps as
 *  text; turned into "-" so lists arrive as lists. */
function normalizeAiMarkdown(text: string): string {
  return text.replace(/^(\s*)[•●◦·]\s+/gm, "$1- ");
}

/** The transaction replacing `[from, to)` with `rawText` parsed as Markdown,
 *  or plain text if it won't parse. Every AI write goes through here. */
export function applyEditRange(
  state: EditorState,
  ctx: Ctx,
  from: number,
  to: number,
  rawText: string,
  /** Footnote definitions `rawText` refers to (`[^3]: …`), which go at
   *  the end of the document. Parsed together with the text: a `[^3]`
   *  whose definition isn't in the same parse stays literal text. */
  footnotes: string[] = [],
) {
  const text = normalizeAiMarkdown(rawText);
  if (footnotes.length > 0) {
    const parsed = parseMarkdownSource(
      ctx,
      `${text}\n\n${footnotes.join("\n")}`,
    );
    if (parsed) {
      const body: ProseNode[] = [];
      const definitions: ProseNode[] = [];
      parsed.content.forEach((node) =>
        (node.type.name === "footnote_definition" ? definitions : body).push(
          node,
        ),
      );
      const tr = state.tr.replaceRange(
        from,
        to,
        Slice.maxOpen(Fragment.from(body)),
      );
      return tr.insert(tr.doc.content.size, definitions);
    }
  }
  return replaceWithMarkdown(state.tr, ctx, from, to, text);
}

/** `[from, to)` of `tr`'s document replaced by `rawText` parsed as
 *  Markdown, as one of several writes in one transaction. */
export function replaceWithMarkdown(
  tr: Transaction,
  ctx: Ctx,
  from: number,
  to: number,
  rawText: string,
): Transaction {
  const text = normalizeAiMarkdown(rawText);
  const parsed = parseMarkdownSource(ctx, text);
  return parsed
    ? tr.replaceRange(from, to, Slice.maxOpen(parsed.content))
    : tr.insertText(text, from, to);
}
