import {
  AllSelection,
  Plugin,
  TextSelection,
  type EditorState,
  type Selection,
} from "@milkdown/kit/prose/state";
import { keydownHandler } from "@milkdown/kit/prose/keymap";
import { $prose } from "@milkdown/kit/utils";
import { isWebKitEngine } from "../../platform/os";
import "./select-all.css";

/** The highlight Select All paints itself: WebKit draws none for the
 *  whole document when it starts beside a heading's fold arrow or a code
 *  block's tools, or ends by a table. Chromium draws its own. */
const HIGHLIGHT = "select-all";
const PAINTS = isWebKitEngine();

function paintedHighlight(): Highlight | null {
  if (!PAINTS || typeof Highlight === "undefined" || !CSS.highlights)
    return null;
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
        let painted: Range[] = [];
        const paint = (state: EditorState) => {
          const all = state.selection instanceof AllSelection;
          const highlight = paintedHighlight();
          for (const range of painted) highlight?.delete(range);
          painted = [];
          if (!all || !highlight) return;
          // A range for each run of text, found afresh on every update (the
          // blocks redraw, a heading's # shown): WebKit paints one range
          // spanning blocks only in its first.
          const walker = document.createTreeWalker(
            view.dom,
            NodeFilter.SHOW_TEXT,
          );
          while (walker.nextNode()) {
            const text = walker.currentNode;
            if (text.parentElement?.closest('[contenteditable="false"]'))
              continue;
            const range = document.createRange();
            range.selectNodeContents(text);
            highlight.add(range);
            painted.push(range);
          }
        };
        paint(view.state);
        return {
          update: (v) => paint(v.state),
          destroy: () => {
            const highlight = paintedHighlight();
            for (const range of painted) highlight?.delete(range);
          },
        };
      },
      props: {
        attributes: (state): Record<string, string> =>
          PAINTS && state.selection instanceof AllSelection
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
