import {
  Plugin,
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
 * Tab at the last cell of a table adds a new row and jumps into it (like
 * spreadsheets/Notion), instead of doing nothing. Registered after gfm in
 * the plugin chain, so gfm's own Tab-to-next-cell keymap already handles
 * every other case - this only ever fires once that's failed (i.e. at the
 * boundary) or when the selection is inside a code block (indentCodeLines).
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
          if (event.shiftKey) return false;

          if (isInTable(state)) {
            const rect = selectedRect(state);
            const atLastCell =
              rect.bottom === rect.map.height && rect.right === rect.map.width;
            if (!atLastCell) return false;

            addRowAfter(view.state, view.dispatch);
            goToNextCell(1)(view.state, view.dispatch);
            return true;
          }

          return false;
        },
      },
    }),
);
