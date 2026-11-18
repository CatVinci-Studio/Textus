import {
  AllSelection,
  Plugin,
  TextSelection,
  type EditorState,
  type Selection,
} from "@milkdown/kit/prose/state";
import { keydownHandler } from "@milkdown/kit/prose/keymap";
import { $prose } from "@milkdown/kit/utils";
import "./select-all.css";

/** The highlight Select All paints itself: WebKit draws none for the
 *  whole document when it starts beside a heading's fold arrow or a code
 *  block's tools, or ends by a table. */
const HIGHLIGHT = "select-all";

function paintedHighlight(): Highlight | null {
  if (typeof Highlight === "undefined" || !CSS.highlights) return null;
  let painted = CSS.highlights.get(HIGHLIGHT);
  if (!painted) CSS.highlights.set(HIGHLIGHT, (painted = new Highlight()));
  return painted;
}

/** Select All: in a code or math block its code first, as in Typora and
 *  VS Code; then, or anywhere else, the whole document. */
export function selectAllIn(state: EditorState): Selection {
  const { $from, $to } = state.selection;
  if ($from.parent.type.spec.code && $from.sameParent($to)) {
    const start = $from.start();
    const end = $from.end();
    if (end > start && ($from.pos > start || $to.pos < end))
      return TextSelection.create(state.doc, start, end);
  }
  return new AllSelection(state.doc);
}

/** Mod+A where the keydown reaches the page (Windows, Linux); macOS's Edit
 *  menu takes it first and calls `selectAllIn` itself. */
export const selectAllKeyPlugin = $prose(
  () =>
    new Plugin({
      view(view) {
        let range: Range | null = null;
        const paint = (all: boolean) => {
          const painted = paintedHighlight();
          if (range) painted?.delete(range);
          range = null;
          if (!all || !painted) return;
          // Made afresh on each update: the blocks it spans are redrawn.
          range = document.createRange();
          range.selectNodeContents(view.dom);
          painted.add(range);
        };
        paint(view.state.selection instanceof AllSelection);
        return {
          update: (v) => paint(v.state.selection instanceof AllSelection),
          destroy: () => paint(false),
        };
      },
      props: {
        attributes: (state): Record<string, string> =>
          state.selection instanceof AllSelection
            ? { class: "is-all-selected" }
            : {},
        handleKeyDown: keydownHandler({
          "Mod-a": (state, dispatch) => {
            dispatch?.(state.tr.setSelection(selectAllIn(state)));
            return true;
          },
        }),
      },
    }),
);
