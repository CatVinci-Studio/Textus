import { schemaCtx, serializerCtx } from "@milkdown/kit/core";
import { Plugin } from "@milkdown/kit/prose/state";
import type { Fragment, Slice } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";

/** The text a copy from inside one code block, formula or inline code
 *  gives, as written - no fence or `$` around it; null for any other copy. */
export function codeTextOf(slice: Slice): string | null {
  let content = slice.content;
  for (let depth = 0; depth < slice.openStart; depth++) {
    if (content.childCount !== 1) return null;
    const node = content.firstChild!;
    if (node.type.spec.code) return node.textContent;
    content = node.content;
  }
  return null;
}

/** One run of plain text and nothing else, which copies as it is: as
 *  Markdown its * and _ would come out escaped. */
function isBareText(content: Fragment): boolean {
  while (content.childCount === 1) {
    const node = content.firstChild!;
    if (node.isText) return true;
    content = node.content;
  }
  return false;
}

/**
 * A copy's plain text is its Markdown source: Markdown apps get the marks,
 * and apps that take formatting read the HTML instead. Code copied from
 * inside a code block is the code alone (codeTextOf). Registered before
 * milkdown's clipboard plugin, whose serializer this replaces: it ended
 * the text with a line break.
 */
export const copyTextPlugin = $prose(
  (ctx) =>
    new Plugin({
      props: {
        clipboardTextSerializer: (slice) => {
          const code = codeTextOf(slice);
          if (code !== null) return code;
          if (isBareText(slice.content))
            return slice.content.textBetween(0, slice.content.size, "\n\n");
          const doc = ctx
            .get(schemaCtx)
            .topNodeType.createAndFill(undefined, slice.content);
          return doc ? ctx.get(serializerCtx)(doc).trimEnd() : "";
        },
      },
    }),
);
