import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { tellCopied } from "./copied";

/** Tells what a copy or cut in the editor put on the clipboard: the
 *  serialized Markdown, as the DOM's text drops math hidden behind KaTeX. */
export const copiedPlugin = $prose(() => {
  const tell = (view: EditorView, cut: boolean) => {
    if (view.state.selection.empty) return;
    const { text } = view.serializeForClipboard(view.state.selection.content());
    tellCopied(text, cut);
  };
  return new Plugin({
    props: {
      handleDOMEvents: {
        // false: the clipboard plugin still does the copy.
        copy: (view) => (tell(view, false), false),
        cut: (view) => (tell(view, true), false),
      },
    },
  });
});
