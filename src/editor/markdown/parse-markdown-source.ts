import type { Ctx } from "@milkdown/kit/ctx";
import { parserCtx } from "@milkdown/kit/core";
import { Slice, type Fragment } from "@milkdown/kit/prose/model";
import { normalizeMathDelimiters } from "../../utils/markdown-math";

/** Text -> parsed ProseMirror doc, with `\[ \]`/`\( \)` LaTeX delimiters
 *  normalized to the `$`/`$$` the math schema recognizes. */
export function parseMarkdownSource(ctx: Ctx, text: string) {
  try {
    return ctx.get(parserCtx)(normalizeMathDelimiters(text));
  } catch {
    return null;
  }
}

/** `content` open down to its first and last textblocks, so a paragraph's
 *  words join the one at the caret; never into an inline node, which
 *  would leave a wiki link or bold words as their bare text. */
export function openToText(content: Fragment): Slice {
  const depth = (edge: "firstChild" | "lastChild") => {
    let node = content[edge];
    let open = 0;
    // As Slice.maxOpen: never into an isolating node (a table cell).
    while (
      node &&
      !node.isInline &&
      !node.isLeaf &&
      !node.type.spec.isolating
    ) {
      open++;
      if (node.isTextblock) break;
      node = node[edge];
    }
    return open;
  };
  return new Slice(content, depth("firstChild"), depth("lastChild"));
}
