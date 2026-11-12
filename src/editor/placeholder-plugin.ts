import type { Node } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { onTourLineHint, tourLineHint } from "./line-hint";

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
/// doesn't look unopened; and on the empty line the caret is on, the tour's
/// next thing to type in its practice tab, or `lineHint()` where the user
/// turned one on.
export function createPlaceholderPlugin(
  getPlaceholder: () => string,
  lineHint: () => string | null = () => null,
) {
  return $prose(() => {
    let dom: HTMLElement | null = null;
    return new Plugin({
      key: placeholderKey,
      view(view) {
        dom = view.dom;
        // The tour moved on: its hint is drawn again at once.
        const stop = onTourLineHint(() =>
          view.dispatch(view.state.tr.setMeta("addToHistory", false)),
        );
        return { destroy: stop };
      },
      props: {
        decorations(state) {
          if (othersDecorate(state, this)) return DecorationSet.empty;
          const tour = dom ? tourLineHint(dom) : null;
          const hint = (from: number, node: Node, text: string | null) =>
            text
              ? DecorationSet.create(state.doc, [
                  Decoration.node(from, from + node.nodeSize, {
                    class: "empty-doc-placeholder",
                    "data-placeholder": text,
                  }),
                ])
              : DecorationSet.empty;
          const first = state.doc.firstChild;
          if (isDocEmpty(state.doc))
            return first
              ? hint(0, first, tour ?? getPlaceholder())
              : DecorationSet.empty;
          // An empty paragraph of the document's own, the caret on it.
          const { selection } = state;
          const { $from } = selection;
          if (
            !selection.empty ||
            $from.depth !== 1 ||
            $from.parent.type.name !== "paragraph" ||
            $from.parent.content.size > 0
          )
            return DecorationSet.empty;
          return hint($from.before(), $from.parent, tour ?? lineHint());
        },
      },
    });
  });
}
