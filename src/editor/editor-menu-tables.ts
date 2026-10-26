import { editorViewCtx } from "@milkdown/kit/core";
import {
  isInTable,
  addRowAfter,
  addRowBefore,
  addColumnAfter,
  addColumnBefore,
  deleteRow,
  deleteColumn,
  deleteTable,
  setCellAttr,
  CellSelection,
  selectionCell,
} from "@milkdown/kit/prose/tables";
import {
  Selection,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { EditorRunner } from "./useEditorRunner";
import type { Strings } from "../i18n/strings";
import type { MenuEntry } from "./editor-menu";

/** Tables in the editor's menus. */

export function runTableCommand(
  run: EditorRunner,
  command: (state: EditorState, dispatch: (tr: Transaction) => void) => boolean,
) {
  run((ctx) => {
    const view = ctx.get(editorViewCtx);
    command(view.state, view.dispatch);
    view.focus();
  });
}

// Grows the selection to the whole row/column of the current cell.
export function selectTableLine(run: EditorRunner, kind: "row" | "column") {
  run((ctx) => {
    const view = ctx.get(editorViewCtx);
    const $cell = selectionCell(view.state);
    if (!$cell) return;
    const selection =
      kind === "row"
        ? CellSelection.rowSelection($cell)
        : CellSelection.colSelection($cell);
    view.dispatch(view.state.tr.setSelection(selection));
    view.focus();
  });
}

// Markdown alignment is per column (the `:---:` row), so a cell alone would
// serialize to something other than what the editor showed.
export function alignTableColumn(
  run: EditorRunner,
  alignment: "left" | "center" | "right",
) {
  run((ctx) => {
    const view = ctx.get(editorViewCtx);
    const $cell = selectionCell(view.state);
    if (!$cell) return;
    view.dispatch(
      view.state.tr.setSelection(CellSelection.colSelection($cell)),
    );
    setCellAttr("alignment", alignment)(view.state, view.dispatch);
    view.dispatch(
      view.state.tr.setSelection(
        Selection.near(view.state.doc.resolve($cell.pos + 1)),
      ),
    );
    view.focus();
  });
}

/** The right-click menu's insert and delete items by name, for the iPhone
 *  keyboard toolbar's table buttons. */
export const TABLE_ACTIONS = {
  "row-above": addRowBefore,
  "row-below": addRowAfter,
  "column-left": addColumnBefore,
  "column-right": addColumnAfter,
  "delete-row": deleteRow,
  "delete-column": deleteColumn,
  "delete-table": deleteTable,
} as const;
export type TableAction = keyof typeof TABLE_ACTIONS;

export function runTableAction(run: EditorRunner, action: string) {
  if (action in TABLE_ACTIONS)
    runTableCommand(run, TABLE_ACTIONS[action as TableAction]);
}

/**
 * A right-click on another table cell moves the caret into it, unless it is
 * inside a cell selection. One outside any table while the caret is in one
 * moves the caret to the pointer, or the menu offers the table's items.
 */
export function moveCaretToClickedCell(
  view: EditorView,
  target: EventTarget | null,
  coords: { left: number; top: number } | null,
) {
  const cell = target instanceof Element ? target.closest("td, th") : null;
  if (!cell || !view.dom.contains(cell)) {
    leaveTableForClick(view, target, coords);
    return;
  }
  let $inside;
  try {
    $inside = view.state.doc.resolve(view.posAtDOM(cell, 0));
  } catch {
    return;
  }
  let depth = $inside.depth;
  while (
    depth > 0 &&
    !$inside.node(depth).type.spec.tableRole?.endsWith("cell")
  )
    depth--;
  if (depth === 0) return;
  const cellStart = $inside.before(depth);
  const { selection } = view.state;
  if (selection instanceof CellSelection) {
    let covered = false;
    selection.forEachCell((_, pos) => {
      if (pos === cellStart) covered = true;
    });
    if (covered) return;
  } else if (
    isInTable(view.state) &&
    selectionCell(view.state).pos === cellStart
  ) {
    return;
  }
  const cellEnd = cellStart + $inside.node(depth).nodeSize - 1;
  view.dispatch(
    view.state.tr.setSelection(
      Selection.near(view.state.doc.resolve(cellEnd), -1),
    ),
  );
}

export function leaveTableForClick(
  view: EditorView,
  target: EventTarget | null,
  coords: { left: number; top: number } | null,
) {
  const { selection } = view.state;
  const inTable =
    selection instanceof CellSelection ||
    (selection.empty && isInTable(view.state));
  if (!inTable || !coords) return;
  if (!(target instanceof Node) || !view.dom.contains(target)) return;
  const hit = view.posAtCoords(coords);
  if (!hit) return;
  view.dispatch(
    view.state.tr.setSelection(Selection.near(view.state.doc.resolve(hit.pos))),
  );
}

export function inTable(run: EditorRunner): boolean {
  return run((ctx) => isInTable(ctx.get(editorViewCtx).state)) ?? false;
}

/** Column alignment and row/column selection. */
export function tableLayoutItems(run: EditorRunner, t: Strings): MenuEntry[] {
  return [
    { label: t.alignLeft, onSelect: () => alignTableColumn(run, "left") },
    { label: t.alignCenter, onSelect: () => alignTableColumn(run, "center") },
    { label: t.alignRight, onSelect: () => alignTableColumn(run, "right") },
    "separator",
    { label: t.selectRow, onSelect: () => selectTableLine(run, "row") },
    { label: t.selectColumn, onSelect: () => selectTableLine(run, "column") },
  ];
}

/** Inserting and deleting rows and columns. */
export function tableEditItems(run: EditorRunner, t: Strings): MenuEntry[] {
  const table = (action: TableAction) => () => runTableAction(run, action);
  return [
    { label: t.insertRowAbove, onSelect: table("row-above") },
    { label: t.insertRowBelow, onSelect: table("row-below") },
    { label: t.insertColumnLeft, onSelect: table("column-left") },
    { label: t.insertColumnRight, onSelect: table("column-right") },
    "separator",
    { label: t.deleteRow, onSelect: table("delete-row"), danger: true },
    { label: t.deleteColumn, onSelect: table("delete-column"), danger: true },
    { label: t.deleteTable, onSelect: table("delete-table"), danger: true },
  ];
}
