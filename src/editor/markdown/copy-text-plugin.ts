import { Plugin } from "@milkdown/kit/prose/state";
import type { Slice } from "@milkdown/kit/prose/model";
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

/**
 * A copy's plain text is its Markdown source, which milkdown's clipboard
 * plugin writes: Markdown apps get the marks, and apps that take
 * formatting read the HTML instead. Code copied from inside a code block is
 * the code alone (codeTextOf). ProseMirror takes the first serializer
 * giving text, so this comes before milkdown's clipboard plugin.
 */
export const codeCopyTextPlugin = $prose(
  () =>
    new Plugin({
      props: {
        clipboardTextSerializer: (slice) => codeTextOf(slice) ?? "",
      },
    }),
);
