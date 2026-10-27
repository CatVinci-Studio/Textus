import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

export const zenFocusKey = new PluginKey("zen-focus");

/**
 * Zen mode's focus: marks the top-level block the caret is in as
 * `.zen-current`, and CSS dims the rest while the root carries `.zen`. One
 * decoration, whatever the document length.
 */
export const zenFocusPlugin = $prose(
  () =>
    new Plugin({
      key: zenFocusKey,
      props: {
        decorations(state) {
          if (!document.documentElement.classList.contains("zen")) return null;
          const $head = state.selection.$head;
          if ($head.depth < 1) return null;
          const from = $head.before(1);
          const node = state.doc.nodeAt(from);
          if (!node) return null;
          return DecorationSet.create(state.doc, [
            Decoration.node(from, from + node.nodeSize, {
              class: "zen-current",
            }),
          ]);
        },
      },
    }),
);
