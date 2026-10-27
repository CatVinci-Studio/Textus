import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { recordClipboardEntry } from "./history";

/**
 * Records Cmd+C/Cmd+X copies from the WYSIWYG editor into the clipboard
 * history as the text the copy puts on the clipboard. The document-level
 * capture in clipboard-history.ts reads the DOM selection, which misses
 * what the editor draws outside the text (a formula behind its render, the
 * ** and $ widgets), so it leaves this editor to this plugin.
 */
export const clipboardHistoryPlugin = $prose(() => {
  const record = (view: EditorView) => {
    if (view.state.selection.empty) return;
    const { text } = view.serializeForClipboard(view.state.selection.content());
    if (text) recordClipboardEntry(text.trimEnd());
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
