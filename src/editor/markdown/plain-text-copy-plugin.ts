import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { plainTextOf } from "./plain-text";

/**
 * The plain text of a copy: the words as they read (plain-text.ts), for the
 * apps that paste only plain text, such as WeChat. Apps that take
 * formatting read the HTML flavour instead, so they get the formatting
 * either way. Edit > Copy as Markdown is there for the Markdown source
 * (useEditorClipboard.ts). ProseMirror takes the first serializer that
 * returns text, so this must come before milkdown's clipboard plugin, whose
 * serializer would write the source.
 */
export const plainTextCopyPlugin = $prose(
  () =>
    new Plugin({
      props: {
        clipboardTextSerializer: (slice) => plainTextOf(slice.content),
      },
    }),
);
