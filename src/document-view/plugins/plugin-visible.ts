import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { cachedDocument } from "../../editor/markdown/doc-markdown";
import { emitPluginEvent, pluginsListen } from "../../plugins/app-bridge";
import { inSight, onEditorScroll } from "./rest-asking";

/** How long scrolling rests before plugins hear what is in sight. */
const SETTLE_MS = 200;

/**
 * Tells plugins which blocks of the document in front are in sight
 * (`editor.onDidChangeVisible`): once scrolling or an edit rests, only
 * when one listens, and only when that changed.
 */
export const pluginVisible = $prose((ctx) => {
  return new Plugin({
    key: new PluginKey("plugin-visible"),
    view(view) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let told = "";
      const tell = () => {
        timer = undefined;
        if (view.isDestroyed || !pluginsListen("visible")) return;
        if (!view.dom.closest('[data-active-tab="true"]')) return;
        const blocks = cachedDocument(ctx, view.state.doc).blocks;
        const [first, last] = inSight(view);
        const range = {
          first: blocks[first]?.id ?? null,
          last: blocks[last]?.id ?? null,
        };
        const key = `${range.first} ${range.last}`;
        if (key === told) return;
        told = key;
        emitPluginEvent("visible", range);
      };
      const soon = () => {
        clearTimeout(timer);
        timer = setTimeout(tell, SETTLE_MS);
      };
      const stopScroll = onEditorScroll(view, soon);
      soon();
      return {
        update(_view, prev) {
          if (prev.doc !== view.state.doc) soon();
        },
        destroy() {
          clearTimeout(timer);
          stopScroll();
        },
      };
    },
  });
});
