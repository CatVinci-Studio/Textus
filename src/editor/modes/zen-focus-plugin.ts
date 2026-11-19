import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

const zenFocusKey = new PluginKey("zen-focus");

/** The top-level block the caret is in, while the window is in zen. */
function currentBlock(state: EditorState): { from: number; to: number } | null {
  if (!document.documentElement.classList.contains("zen")) return null;
  const $head = state.selection.$head;
  if ($head.depth < 1) return null;
  const from = $head.before(1);
  const node = state.doc.nodeAt(from);
  return node ? { from, to: from + node.nodeSize } : null;
}

/**
 * Zen mode's focus: marks the top-level block the caret is in as
 * `.zen-current`, and CSS dims the rest while the root carries `.zen`. One
 * decoration, whatever the document length; the editor says it has one
 * itself, so no rule asks its children (each block added or removed would
 * restyle all of them).
 */
export const zenFocusPlugin = $prose(
  () =>
    new Plugin({
      key: zenFocusKey,
      props: {
        attributes: (state): Record<string, string> =>
          currentBlock(state) ? { "data-zen-focus": "" } : {},
        decorations(state) {
          const block = currentBlock(state);
          if (!block) return null;
          return DecorationSet.create(state.doc, [
            Decoration.node(block.from, block.to, { class: "zen-current" }),
          ]);
        },
      },
    }),
);
