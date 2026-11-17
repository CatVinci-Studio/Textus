import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import { insertTableCommand } from "@milkdown/kit/preset/gfm";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { Node } from "@milkdown/kit/prose/model";
import type { EditorRunner } from "../useEditorRunner";

/** Where the first table at or after `from` starts; null with none. */
function firstTableFrom(doc: Node, from: number): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.spec.tableRole === "table" && pos + node.nodeSize > from) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

/** A new table of `rows` × `cols` at the caret, the caret in its first
 *  cell. */
export function insertTable(run: EditorRunner, rows: number, cols: number) {
  run((ctx) => {
    const view = ctx.get(editorViewCtx);
    const from = view.state.selection.from;
    ctx.get(commandsCtx).call(insertTableCommand.key, { row: rows, col: cols });
    // The command leaves the caret where it was when the table goes in
    // after a line's text: into the new table's first cell.
    const table = firstTableFrom(view.state.doc, from);
    if (table !== null)
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.near(view.state.doc.resolve(table + 1)),
        ),
      );
    view.focus();
    // And again as the dialog lets go and the keyboard comes back: WebKit
    // puts its old caret back some time after, not at once. Only while
    // nothing was typed: then a moved caret is WebKit's.
    const at = view.state.selection;
    const doc = view.state.doc;
    // A key or a press since is the writer's own move (Tab to the next
    // cell, an arrow): the caret is theirs from then on.
    let moved = false;
    const own = () => (moved = true);
    for (const type of ["keydown", "pointerdown"])
      view.dom.addEventListener(type, own, { capture: true, once: true });
    const back = () => {
      if (moved || view.isDestroyed || view.state.doc !== doc) return;
      // focus() writes the state's caret into the page, where WebKit may
      // have moved it without telling.
      if (!view.state.selection.eq(at))
        view.dispatch(view.state.tr.setSelection(at));
      view.focus();
    };
    requestAnimationFrame(back);
    for (const ms of [150, 400]) setTimeout(back, ms);
  });
}
