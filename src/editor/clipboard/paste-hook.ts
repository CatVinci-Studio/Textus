import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { editorExtensions } from "../extension-points";
import { insertMarkdown } from "../markdown/parse-markdown-source";

/** The paste put back after no one took it: not asked about again. */
const replayed = new WeakSet<Event>();

/**
 * Pasted text a plugin takes (extension-points `pasteMatches`) goes in as
 * the Markdown it answers; when it answers nothing, the same paste is
 * dispatched again and goes on as usual. Text no one takes is never held.
 */
export const pasteHookPlugin = $prose(
  (ctx) =>
    new Plugin({
      props: {
        handlePaste(view, event) {
          const data = event.clipboardData;
          const text = data?.getData?.("text/plain") ?? "";
          if (replayed.has(event) || !data || !text || data.files?.length)
            return false;
          if (view.state.selection.$from.parent.type.spec.code) return false;
          const { pasteMatches, providePaste } = editorExtensions();
          if (!pasteMatches(text)) return false;
          const html = data.getData?.("text/html") ?? "";
          void providePaste(text).then((markdown) => {
            if (view.isDestroyed) return;
            if (markdown !== null) {
              view.dispatch(
                insertMarkdown(view.state.tr, ctx, markdown)
                  .setMeta("uiEvent", "paste")
                  .scrollIntoView(),
              );
              return;
            }
            // What ProseMirror and the paste handlers read of a paste.
            const data: Record<string, string> = { "text/plain": text };
            if (html) data["text/html"] = html;
            const replay = new Event("paste", {
              bubbles: true,
              cancelable: true,
            });
            Object.defineProperty(replay, "clipboardData", {
              value: {
                types: Object.keys(data),
                files: [],
                items: [],
                getData: (type: string) => data[type] ?? "",
              },
            });
            replayed.add(replay);
            view.dom.dispatchEvent(replay);
          });
          return true;
        },
      },
    }),
);
