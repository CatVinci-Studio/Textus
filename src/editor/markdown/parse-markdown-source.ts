import type { Ctx } from "@milkdown/kit/ctx";
import { parserCtx } from "@milkdown/kit/core";
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
