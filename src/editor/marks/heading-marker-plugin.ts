import { Plugin, PluginKey, Selection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { EditorState } from "@milkdown/kit/prose/state";
import { isImeKeyEvent, stateWithLiveSelection } from "./enclosure";

const headingMarkerKey = new PluginKey("heading-marker");

function makeMarkerEl(prefix: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "heading-marker";
  span.textContent = prefix;
  span.contentEditable = "false";
  return span;
}

function buildDecorations(state: EditorState): DecorationSet {
  const { selection } = state;
  const decorations: Decoration[] = [];

  state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (node.type.name !== "heading") return !node.isTextblock;

    const from = pos;
    const to = pos + node.nodeSize;
    // Content bounds, not the node's: a cursor just moved onto the next block
    // isn't inside the heading.
    const cursorInside = selection.from <= to - 1 && selection.to >= from + 1;
    if (!cursorInside) return;

    const level = (node.attrs.level as number) ?? 1;
    // A real widget, not ::before: WKWebView drew the caret in front of a
    // generated "#" prefix. ProseMirror keeps the caret on the content side of a
    // side -1 widget.
    decorations.push(
      Decoration.widget(from + 1, () => makeMarkerEl("#".repeat(level) + " "), {
        side: -1,
        key: `hm${level}`,
      }),
    );
  });

  return DecorationSet.create(state.doc, decorations);
}

/** Typora-style reveal: a heading's "# " prefix shows only while the cursor
 *  is on that line. */
export const headingMarkerPlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: headingMarkerKey,
      state: {
        init: (_config, state) => buildDecorations(state),
        apply(tr, prev, _oldState, newState) {
          if (!tr.docChanged && !tr.selectionSet) return prev;
          return buildDecorations(newState);
        },
      },
      props: {
        decorations(state) {
          return headingMarkerKey.getState(state);
        },
        handleKeyDown(view, event) {
          if (isImeKeyEvent(view, event)) return false;

          // Backspace at the start of a heading makes it body text at any level, as
          // in Typora; Milkdown's keymap stepped it down one level at a time.
          if (
            event.key === "Backspace" &&
            !event.metaKey &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.shiftKey
          ) {
            const state = stateWithLiveSelection(view);
            const { $from, empty } = state.selection;
            if (!empty || $from.parent.type.name !== "heading") return false;
            if ($from.parentOffset !== 0) return false;
            event.preventDefault();
            view.dispatch(
              state.tr.setNodeMarkup(
                $from.before(),
                state.schema.nodes.paragraph,
              ),
            );
            return true;
          }


          if (event.key !== "ArrowLeft") return false;
          if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey)
            return false;
          const { state } = view;
          const { $from, empty } = state.selection;
          if (!empty) return false;
          if ($from.parent.type.name !== "heading" || $from.parentOffset !== 0)
            return false;
          // The "# " widget leaves native Left nothing to move onto, so hop to the end
          // of the previous block explicitly.
          const target = Selection.near(
            state.doc.resolve($from.before($from.depth)),
            -1,
          );
          if (target.from === state.selection.from) return false;
          event.preventDefault();
          view.dispatch(state.tr.setSelection(target));
          return true;
        },
      },
    }),
);
