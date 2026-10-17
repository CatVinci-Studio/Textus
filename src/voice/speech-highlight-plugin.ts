import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

export const speechHighlightKey = new PluginKey<{
  from: number;
  to: number;
} | null>("speech-highlight");
export const speechHighlightPlugin = $prose(
  () =>
    new Plugin({
      key: speechHighlightKey,
      state: {
        init: () => null,
        apply(tr, previous) {
          const requested = tr.getMeta(speechHighlightKey);
          if (requested !== undefined) return requested;
          if (!previous || tr.docChanged) return null;
          return previous;
        },
      },
      props: {
        decorations(state) {
          const range = speechHighlightKey.getState(state);
          return range &&
            range.from >= 0 &&
            range.to <= state.doc.content.size &&
            range.from < range.to
            ? DecorationSet.create(state.doc, [
                Decoration.inline(range.from, range.to, {
                  class: "speech-reading",
                }),
              ])
            : DecorationSet.empty;
        },
      },
    }),
);
