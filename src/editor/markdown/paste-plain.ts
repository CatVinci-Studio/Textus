import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { modIsMeta } from "../../platform/os";

/** Paste as Plain Text: the clipboard's text as it is, through
 *  ProseMirror's plain-text paste - its lines as lines, no Markdown read. */
export async function pastePlainText(view: EditorView): Promise<void> {
  const text = await navigator.clipboard.readText().catch(() => "");
  if (text) view.pasteText(text);
  view.focus();
}

/** Mod+Shift+V. On macOS the Edit menu's key takes it first; elsewhere the
 *  webview's own Ctrl+Shift+V paste would read the text as Markdown. */
export const pastePlainTextKeyPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleKeyDown(view, event) {
          if (event.code !== "KeyV" || !event.shiftKey || event.altKey)
            return false;
          if (!(modIsMeta() ? event.metaKey : event.ctrlKey)) return false;
          event.preventDefault();
          void pastePlainText(view);
          return true;
        },
      },
    }),
);
