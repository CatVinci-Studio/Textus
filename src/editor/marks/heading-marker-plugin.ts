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
    // Content bounds, not the node's outer bounds - touching the boundary
    // from outside (e.g. cursor just moved onto the next block) shouldn't
    // count as "inside" the heading.
    const cursorInside = selection.from <= to - 1 && selection.to >= from + 1;
    if (!cursorInside) return;

    const level = (node.attrs.level as number) ?? 1;
    // A real widget element, not a CSS ::before on the heading: WKWebView
    // (the Tauri webview) draws the caret for "start of text that carries
    // ::before content" visually BEFORE the generated prefix, so the cursor
    // appeared to sit in front of the "#" instead of after it. A real
    // element gives the caret an unambiguous DOM position on each side, and
    // ProseMirror canonicalizes the caret to the content side of a
    // side: -1 widget.
    decorations.push(
      Decoration.widget(from + 1, () => makeMarkerEl("#".repeat(level) + " "), {
        side: -1,
        key: `hm${level}`,
      }),
    );
  });

  return DecorationSet.create(state.doc, decorations);
}

/**
 * Typora-style reveal: the "# "/"## " prefix for a heading only shows up
 * while the cursor is on that line, otherwise the heading renders as plain
 * large/bold text with no marker (which is how headings render regardless -
 * this only toggles the prefix, not the heading styling itself).
 */
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

          // Backspace at the start of a heading makes it body text, at any
          // level, as in Typora - Milkdown's keymap stepped it down one
          // level at a time (an H3 took three presses).
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
          // The revealed "# " prefix is a non-editable widget sitting between
          // the caret and the start of the line, so native Left-arrow has no
          // real text to move onto and stalls there. Hop to the end of the
          // previous block explicitly.
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
