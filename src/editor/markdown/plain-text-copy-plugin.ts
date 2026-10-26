import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { plainTextOf } from "./plain-text";

/**
 * The plain text of a copy, for apps that paste only plain text (WeChat).
 * Must come before milkdown's clipboard plugin, whose serializer would
 * write the Markdown source: ProseMirror takes the first that returns text.
 */
export const plainTextCopyPlugin = $prose(
  () =>
    new Plugin({
      props: {
        clipboardTextSerializer: (slice) => plainTextOf(slice.content),
      },
    }),
);
