import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import "./inactive-selection.css";

/**
 * WebKit stops painting a contenteditable's selection once focus leaves it -
 * for the right-click menu, Quick Ask's field, the Agent panel. The text the
 * action is about then looks deselected. While the editor is unfocused this
 * paints the selection itself, the way code editors show an inactive one.
 */
const key = new PluginKey<boolean>("inactive-selection");

export const inactiveSelectionPlugin = $prose(
  () =>
    new Plugin<boolean>({
      key,
      state: {
        init: () => false,
        apply: (tr, blurred) =>
          (tr.getMeta(key) as boolean | undefined) ?? blurred,
      },
      props: {
        decorations(state) {
          const { selection } = state;
          if (
            !key.getState(state) ||
            selection.empty ||
            !(selection instanceof TextSelection)
          )
            return null;
          return DecorationSet.create(state.doc, [
            Decoration.inline(selection.from, selection.to, {
              class: "inactive-selection",
            }),
          ]);
        },
        handleDOMEvents: {
          blur(view) {
            view.dispatch(
              view.state.tr.setMeta(key, true).setMeta("addToHistory", false),
            );
            return false;
          },
          focus(view) {
            if (key.getState(view.state))
              view.dispatch(
                view.state.tr
                  .setMeta(key, false)
                  .setMeta("addToHistory", false),
              );
            return false;
          },
        },
      },
    }),
);
