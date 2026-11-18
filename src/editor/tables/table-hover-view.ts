import { $prose, $view } from "@milkdown/kit/utils";
import { serializerCtx } from "@milkdown/kit/core";
import type { Decoration } from "@milkdown/kit/prose/view";
import type { Strings } from "../../i18n/strings";
import { TABLE_CARET_SPEC } from "./table-caret";
import {
  alignColumns,
  resizeTable,
  sharedAlignment,
  tableSize,
} from "./table-edits";
import { mountTableToolbar } from "./TableToolbar";
import { dragColumnEdge, setCells, type HeldCell } from "./column-edge-drag";
import { attachGrips } from "./table-grips";
import { copyTable } from "../clipboard/table-clipboard";
import { watchScrollFade } from "../../engine/controls/scroll-fade";
import { tableSchema } from "@milkdown/kit/preset/gfm";
import {
  addRowAfter,
  addColumnAfter,
  CellSelection,
  columnResizing,
  columnResizingPluginKey,
  TableMap,
  updateColumnsOnResize,
} from "@milkdown/kit/prose/tables";

// prosemirror-tables' columnResizing default, so the <colgroup> and the
// resize drag share one baseline.
const DEFAULT_CELL_MIN_WIDTH = 100;

/**
 * Syncs the <colgroup> with the columns' dragged widths, then picks the
 * layout: until a column is resized the table lays out by content, as on
 * GitHub, and the 100px-per-column min-width (which pushed many short
 * columns past the text) is dropped.
 */
function syncColumns(
  node: Parameters<typeof updateColumnsOnResize>[0],
  colgroup: HTMLTableColElement,
  table: HTMLTableElement,
): void {
  updateColumnsOnResize(node, colgroup, table, DEFAULT_CELL_MIN_WIDTH);
  let sized = false;
  node.firstChild?.forEach((cell) => {
    if ((cell.attrs.colwidth as number[] | null)?.some(Boolean)) sized = true;
  });
  if (sized) {
    table.dataset.sized = "";
  } else {
    delete table.dataset.sized;
    table.style.minWidth = "";
  }
}
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { PLUS_ICON_HTML } from "../../engine/controls/icons";

type TableCommand = (
  state: EditorState,
  dispatch: (tr: Transaction) => void,
) => boolean;

/**
 * Moves the selection into the table's last cell, the anchor from which
 * addRowAfter and addColumnAfter each append one at the end. TableMap keeps
 * it right across merged cells.
 */
function focusLastCell(view: EditorView, tablePos: number): boolean {
  const table = view.state.doc.nodeAt(tablePos);
  if (!table) return false;
  const map = TableMap.get(table);
  const lastCellPos =
    tablePos + 1 + map.positionAt(map.height - 1, map.width - 1, table);
  const $pos = view.state.doc.resolve(
    Math.min(lastCellPos + 1, view.state.doc.content.size),
  );
  view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)));
  return true;
}

function bindInsertButton(
  button: HTMLButtonElement,
  view: EditorView,
  getPos: () => number | undefined,
  command: TableCommand,
): void {
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const pos = getPos();
    if (pos == null || !focusLastCell(view, pos)) return;
    command(view.state, view.dispatch);
    view.focus();
  });
}

function makeInsertButton(className: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.contentEditable = "false";
  button.innerHTML = PLUS_ICON_HTML;
  // A pointer shortcut only: the keyboard and screen readers have the same
  // commands in the context menu, so these stay out of the tab order.
  button.tabIndex = -1;
  button.setAttribute("aria-hidden", "true");
  return button;
}

/**
 * Wraps the table's own <table><tbody> (still the contentDOM) with "+"
 * buttons on the bottom and right edges, shown on hover, a horizontal
 * scroller for wide tables, and its tools at the top right (alignment,
 * size, Copy, Delete), shown on hover and while the caret is in it. It
 * also renders the <colgroup> column resizing writes into, as the table's
 * first child. Widths are session-only: GFM can't store them.
 */
export function createTableView(strings: () => Strings) {
  return $view(tableSchema.node, (ctx) => (node, view, getPos, decorations) => {
    let currentNode = node;
    let caretCols = caretColsOf(decorations);
    const wrapper = document.createElement("div");
    wrapper.className = "table-wrapper";

    const table = document.createElement("table");
    table.style.setProperty(
      "--default-cell-min-width",
      `${DEFAULT_CELL_MIN_WIDTH}px`,
    );
    const colgroup = table.appendChild(document.createElement("colgroup"));
    const tbody = table.appendChild(document.createElement("tbody"));
    syncColumns(node, colgroup, table);

    const addRowBtn = makeInsertButton("table-add-row-btn");
    bindInsertButton(addRowBtn, view, getPos, addRowAfter);

    const addColBtn = makeInsertButton("table-add-col-btn");
    bindInsertButton(addColBtn, view, getPos, addColumnAfter);

    const scroller = wrapper.appendChild(document.createElement("div"));
    // Wider than its column, the edge it goes on past fades.
    scroller.className = "table-scroll tx-scroll-fade";
    // The column strip goes with the table's real end, scrolled with it.
    const track = scroller.appendChild(document.createElement("div"));
    track.className = "table-track";
    track.append(table, addColBtn);
    wrapper.appendChild(addRowBtn);
    const unfade = watchScrollFade(scroller, "x");
    const grips = attachGrips({ wrapper, table, tbody, view, getPos });
    const followCaret = () => {
      // Picked cells (a grip's row or column) leave the grips where they
      // were; a table gone by now has none.
      if (view.state.selection instanceof CellSelection) return;
      if (!wrapper.isConnected || view.isDestroyed) return;
      const at = view.domAtPos(view.state.selection.from).node;
      const el = at instanceof Element ? at : at.parentElement;
      grips.follow(el?.closest<HTMLElement>("td, th") ?? null);
    };

    const header = wrapper.appendChild(document.createElement("div"));
    header.className = "block-toolbar table-toolbar";
    header.contentEditable = "false";
    const actions = header.appendChild(document.createElement("div"));
    actions.className = "block-toolbar-actions";

    // `refocus`: back to the text, but not from the size card, whose
    // buttons are pressed again and again.
    const edit = (
      make: (tr: Transaction, pos: number) => Transaction,
      refocus = true,
    ) => {
      const pos = getPos();
      if (pos == null) return;
      view.dispatch(make(view.state.tr, pos));
      if (refocus) view.focus();
    };
    // Mounted on first hover or caret: a long document has many tables.
    let tools: ReturnType<typeof mountTableToolbar> | null = null;
    const render = () => {
      if (!tools) return;
      const size = tableSize(currentNode);
      tools.render({
        t: strings(),
        ...size,
        filled: (r, c) =>
          !!currentNode.maybeChild(r)?.maybeChild(c)?.textContent.trim(),
        align: caretCols.length
          ? sharedAlignment(currentNode, caretCols)
          : undefined,
        editable: view.editable,
        onAlign: (a) => edit((tr, pos) => alignColumns(tr, pos, caretCols, a)),
        onSize: (rows, cols) =>
          edit((tr, pos) => resizeTable(tr, pos, rows, cols), false),
        onCopy: () => copyTable(view, currentNode, ctx.get(serializerCtx)),
        onDelete: () =>
          edit((tr, pos) => tr.delete(pos, pos + currentNode.nodeSize)),
        onOpenChange: (open) => wrapper.classList.toggle("is-sizing", open),
      });
    };
    const showTools = () => {
      tools ??= mountTableToolbar(actions);
      render();
    };
    // Not mounted under a held button: new nodes under a text drag make
    // WebKit start the selection over.
    wrapper.addEventListener("pointerenter", (event) => {
      if (!event.buttons) showTools();
    });
    wrapper.addEventListener("pointermove", (event) => {
      if (!tools && !event.buttons) showTools();
    });
    if (caretCols.length) showTools();

    return {
      dom: wrapper,
      contentDOM: tbody,
      update(updatedNode, updatedDecorations) {
        if (updatedNode.type !== currentNode.type) return false;
        currentNode = updatedNode;
        caretCols = caretColsOf(updatedDecorations);
        syncColumns(updatedNode, colgroup, table);
        // The rows are redrawn after this: the caret's cell is read once
        // the view's update is through.
        if (caretCols.length) {
          showTools();
          queueMicrotask(followCaret);
        } else render();
        return true;
      },
      // Keys and presses on its tools, grips and "+" strips aren't the
      // editor's: a press on the strip under the table was also a click
      // below the document's end.
      stopEvent: (event) =>
        header.contains(event.target as Node) ||
        addRowBtn.contains(event.target as Node) ||
        addColBtn.contains(event.target as Node) ||
        (event.target as Element).classList?.contains("table-grip"),
      // Only the cells are the document's: its tools, buttons and the
      // resize drag's widths on the table and its <col>s change under the
      // view's DOM observer.
      ignoreMutation(record) {
        if (record.type === "selection") return false;
        return !tbody.contains(record.target);
      },
      destroy() {
        unfade();
        grips.destroy();
        tools?.destroy();
      },
    };
  });
}

/** The columns the caret is in, from tableCaretPlugin's decoration. */
function caretColsOf(decorations: readonly Decoration[]): number[] {
  for (const d of decorations) {
    const cols = (d.spec as Record<string, unknown>)[TABLE_CARET_SPEC];
    if (Array.isArray(cols)) return cols as number[];
  }
  return [];
}

/**
 * Drag-to-resize columns: prosemirror-tables' columnResizing, with
 * `View: null` so tableHoverView stays the node view.
 */
export const tableColumnResizing = $prose(() => columnResizing({ View: null }));

/**
 * A column's edge dragged (column-edge-drag.ts). Before that, in a table
 * laid out by its content,
 * every column is held at the width it shows: the drag then changes that
 * column alone, the ones before it standing still and the table growing or
 * shrinking, rather than its unsized neighbours sharing the change.
 */
export const tableColumnFreeze = $prose(
  () =>
    new Plugin({
      props: {
        handleDOMEvents: {
          // A text drag passing a column edge: no resize handle drawn into
          // the cells under it (columnResizing's hover ignores the button).
          mousemove(view, event) {
            if (!event.buttons) return false;
            const state = columnResizingPluginKey.getState(view.state);
            return !state?.dragging;
          },
          mousedown(view, event) {
            if (event.button !== 0) return false;
            const handle = columnResizingPluginKey.getState(
              view.state,
            )?.activeHandle;
            if (handle === undefined || handle < 0) return false;
            const held = frozenColumns(view, handle);
            if (held.length)
              view.dispatch(
                setCells(view.state.tr, held, "held").setMeta(
                  "addToHistory",
                  false,
                ),
              );
            dragColumnEdge(view, handle, event, DEFAULT_CELL_MIN_WIDTH, held);
            event.preventDefault();
            return true;
          },
        },
      },
    }),
);

/** Every cell of the table holding the cell at `pos` that has no widths,
 *  with the widths its columns show now; none when they all have widths. */
function frozenColumns(view: EditorView, pos: number): HeldCell[] {
  const $cell = view.state.doc.resolve(pos);
  const table = $cell.node(-1);
  if (!table || table.type.spec.tableRole !== "table") return [];
  const start = $cell.start(-1);
  const map = TableMap.get(table);
  const widths: number[] = [];
  for (let col = 0; col < map.width; col++) {
    const at = map.map[col];
    const cell = table.nodeAt(at);
    const dom = view.nodeDOM(start + at) as HTMLElement | null;
    const span = (cell?.attrs.colspan as number) || 1;
    widths[col] = dom ? Math.round(dom.offsetWidth / span) : 0;
  }
  if (widths.some((w) => !w)) return [];
  const held: HeldCell[] = [];
  const seen = new Set<number>();
  for (const at of map.map) {
    if (seen.has(at)) continue;
    seen.add(at);
    const cell = table.nodeAt(at);
    if (!cell) continue;
    const has = cell.attrs.colwidth as number[] | null;
    const span = (cell.attrs.colspan as number) || 1;
    if (has && has.length === span && has.every(Boolean)) continue;
    const col = map.colCount(at);
    held.push({
      pos: start + at,
      was: cell.attrs,
      held: { ...cell.attrs, colwidth: widths.slice(col, col + span) },
    });
  }
  return held;
}
