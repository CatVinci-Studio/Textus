import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import { insertTableCommand } from "@milkdown/kit/preset/gfm";
import type { EditorRunner } from "../useEditorRunner";

/** A new table of `rows` × `cols` at the caret, the caret in its first
 *  cell. */
export function insertTable(run: EditorRunner, rows: number, cols: number) {
  run((ctx) => {
    const view = ctx.get(editorViewCtx);
    // Focused first: WebKit given focus afterwards puts back the caret it
    // had before the dialog (iOS), over the new table's first cell.
    view.focus();
    ctx.get(commandsCtx).call(insertTableCommand.key, { row: rows, col: cols });
    // And once more after the dialog has let go of it.
    requestAnimationFrame(() => {
      if (view.isDestroyed) return;
      view.focus();
      view.dispatch(view.state.tr.setSelection(view.state.selection));
    });
  });
}
