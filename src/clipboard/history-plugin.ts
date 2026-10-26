import { serializerCtx } from "@milkdown/kit/core";
import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { recordClipboardEntry } from "./history";

/**
 * Records copies from the WYSIWYG editor into the clipboard history as
 * markdown source. The DOM selection's text would drop math source hidden
 * behind KaTeX and the synthesized delimiter widgets.
 */
export const clipboardHistoryPlugin = $prose((ctx) => {
  const record = (view: EditorView) => {
    const { state } = view;
    const { from, to } = state.selection;
    if (from === to) return;
    let text: string;
    try {
      text = ctx.get(serializerCtx)(state.doc.cut(from, to)).trimEnd();
    } catch {
      text = state.doc.textBetween(from, to, "\n");
    }
    if (text) recordClipboardEntry(text);
  };
  return new Plugin({
    props: {
      handleDOMEvents: {
        copy: (view) => {
          record(view);
          return false; // the clipboard plugin still does the actual copy
        },
        cut: (view) => {
          record(view);
          return false;
        },
      },
    },
  });
});
