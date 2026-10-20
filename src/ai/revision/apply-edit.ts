import type { EditorState } from "@milkdown/kit/prose/state";
import type { Ctx } from "@milkdown/kit/ctx";
import {
  Fragment,
  Slice,
  type Node as ProseNode,
} from "@milkdown/kit/prose/model";
import { parseMarkdownSource } from "../../editor/markdown/parse-markdown-source";

/**
 * Models routinely bullet lists with typographic dots ("•", "●", "◦", "·")
 * instead of markdown "-" - as plain text those survive the markdown parse
 * and land verbatim in the document. Rewrite them to "-" so lists arrive as
 * lists. Shared by every path that writes an AI reply into the document.
 */
function normalizeAiMarkdown(text: string): string {
  return text.replace(/^(\s*)[•●◦·]\s+/gm, "$1- ");
}

/**
 * Builds the transaction that replaces `[from, to)` with `rawText`, parsed
 * as markdown so formatted content lands rendered (falling back to a plain
 * text insert if it doesn't parse). The one place every "write an AI reply
 * into the document" flow converges: free-text apply and a propose_edit
 * Apply click (useInlineChat.ts) and accepting an in-document pending edit
 * (usePendingEdits.ts) all build their transaction here, so the three paths
 * can't drift on how markdown gets parsed.
 */
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
  const parsed = parseMarkdownSource(ctx, text);
  return parsed
    ? state.tr.replaceRange(from, to, Slice.maxOpen(parsed.content))
    : state.tr.insertText(text, from, to);
}
