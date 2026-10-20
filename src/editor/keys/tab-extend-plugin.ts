import {
  Plugin,
  Selection,
  type Command,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import {
  isInTable,
  selectedRect,
  addRowAfter,
  goToNextCell,
} from "@milkdown/kit/prose/tables";
import { isImeKeyEvent, stateWithLiveSelection } from "../marks/enclosure";

const INDENT = "  ";

/**
 * Tab and Shift+Tab in a code block. With the caret on one line, Tab puts
 * in an indent at the caret; with lines selected, it indents each of them
 * (it used to replace the selection with the indent). Shift+Tab takes one
 * indent - two spaces, or a tab - off the start of each line touched.
 * Null when there is nothing to do, or the selection leaves the block.
 */
export function indentCodeLines(
  state: EditorState,
  direction: 1 | -1,
): Transaction | null {
  const { $from, $to, empty } = state.selection;
  if (!$from.sameParent($to)) return null;
  if (direction === 1 && empty) return state.tr.insertText(INDENT);
  const start = $from.start();
  const text = $from.parent.textContent;
  const lineStarts: number[] = [];
  let at = text.lastIndexOf("\n", $from.parentOffset - 1) + 1;
  for (;;) {
    lineStarts.push(at);
    const next = text.indexOf("\n", at);
    // A selection ending at a line's start leaves that line alone.
    if (next < 0 || next + 1 >= $to.parentOffset) break;
    at = next + 1;
  }
  const tr = state.tr;
  // Last line first, so the earlier offsets still hold.
  for (const line of lineStarts.reverse()) {
    if (direction === 1) {
      tr.insertText(INDENT, start + line);
      continue;
    }
    const lead = /^(\t| {1,2})/.exec(text.slice(line))?.[0].length ?? 0;
    if (lead) tr.delete(start + line, start + line + lead);
  }
  return tr.docChanged ? tr : null;
}

/**
 * Tab / Shift+Tab in a table: the next / previous cell, with the caret at
 * the end of its text. prosemirror-tables' own command (gfm's Tab keymap)
 * selects the whole cell instead, and the next character typed replaced
 * it. In the first cell Shift+Tab does nothing here.
 */
export const moveToCell =
  (direction: 1 | -1): Command =>
  (state, dispatch) => {
    let moved: Transaction | undefined;
    if (!goToNextCell(direction)(state, (tr) => (moved = tr))) return false;
    if (dispatch && moved) {
      const $end = moved.doc.resolve(moved.selection.to);
      dispatch(moved.setSelection(Selection.near($end, -1)).scrollIntoView());
    }
    return true;
  };

/**
 * Tab at the last cell of a table adds a new row and jumps into it (like
 * spreadsheets/Notion), instead of doing nothing; anywhere else in a table
 * Tab and Shift+Tab move between cells (moveToCell). $prose plugins run
 * ahead of the preset keymaps, so this wins over gfm's table keymap. In a
 * code block Tab indents (indentCodeLines).
 */
export const tabExtendPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleKeyDown(view, event) {
          if (event.key !== "Tab" || isImeKeyEvent(view, event)) return false;
          // Ctrl+Tab goes to the next document tab.
          if (event.ctrlKey || event.metaKey || event.altKey) return false;

          const state = stateWithLiveSelection(view);
          const { $from } = state.selection;

          if ($from.parent.type.name === "code_block") {
            const tr = indentCodeLines(state, event.shiftKey ? -1 : 1);
            if (tr) view.dispatch(tr.scrollIntoView());
            // Never on to the browser, which moves the focus out.
            return true;
          }
          if (event.shiftKey)
            return isInTable(state) && moveToCell(-1)(state, view.dispatch);

          if (isInTable(state)) {
            const rect = selectedRect(state);
            const atLastCell =
              rect.bottom === rect.map.height && rect.right === rect.map.width;
            if (!atLastCell) return moveToCell(1)(state, view.dispatch);

            addRowAfter(state, view.dispatch);
            moveToCell(1)(view.state, view.dispatch);
            return true;
          }

          return false;
        },
      },
    }),
);

/**
 * Tab and Shift+Tab never take the focus out of the text: where nothing
 * else uses them - a paragraph, a list's first item, which can't go in -
 * they do nothing, as in Typora, instead of moving the focus to the next
 * button. F6 is the way out of the editor (app/regions.ts). A listener of
 * its own, added after ProseMirror's, so every key handler - lists,
 * tables, accepting a completion - has had its turn and marked the event
 * when it used it.
 */
export const tabStaysPlugin = $prose(
  () =>
    new Plugin({
      view(view) {
        const keepFocus = (event: KeyboardEvent) => {
          if (event.key !== "Tab" || event.defaultPrevented) return;
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.isComposing) return;
          event.preventDefault();
        };
        view.dom.addEventListener("keydown", keepFocus);
        return {
          destroy: () => view.dom.removeEventListener("keydown", keepFocus),
        };
      },
    }),
);
