import type { Node } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

const placeholderKey = new PluginKey("empty-doc-placeholder");

function isDocEmpty(doc: Node): boolean {
  if (doc.childCount > 1) return false;
  const first = doc.firstChild;
  if (!first) return true;
  // Still a plain paragraph: "# " makes an empty heading, which would
  // otherwise keep showing the placeholder.
  return first.type.name === "paragraph" && first.content.size === 0;
}

/** Whether another plugin draws into the document (AI text, a completion),
 *  which the hint would overlap. */
function othersDecorate(state: EditorState, self: Plugin): boolean {
  return state.plugins.some((plugin) => {
    if (plugin === self) return false;
    const decorations = plugin.props.decorations?.call(plugin, state);
    return (
      decorations instanceof DecorationSet && decorations.find().length > 0
    );
  });
}

/// A grayed-out hint when the whole document is empty, so a blank document
/// doesn't look unopened.
export function createPlaceholderPlugin(getPlaceholder: () => string) {
  return $prose(
    () =>
      new Plugin({
        key: placeholderKey,
        props: {
          decorations(state) {
            if (!isDocEmpty(state.doc) || othersDecorate(state, this))
              return DecorationSet.empty;

            const node = state.doc.firstChild;
            if (!node) return DecorationSet.empty;

            return DecorationSet.create(state.doc, [
              Decoration.node(0, node.nodeSize, {
                class: "empty-doc-placeholder",
                "data-placeholder": getPlaceholder(),
              }),
            ]);
          },
        },
      }),
  );
}
