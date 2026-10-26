import { $prose, $view } from "@milkdown/kit/utils";
import { tableSchema } from "@milkdown/kit/preset/gfm";
import {
  addRowAfter,
  addColumnAfter,
  columnResizing,
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
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { PLUS_ICON_HTML } from "../../ui/icons";

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
 * buttons on the bottom and right edges, shown on hover, and a horizontal
 * scroller for wide tables. It also renders the <colgroup> column resizing
 * writes into, as the table's first child. Widths are session-only: GFM
 * can't store them.
 */
export const tableHoverView = $view(
  tableSchema.node,
  () => (node, view, getPos) => {
    let currentNode = node;
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
    scroller.className = "table-scroll";
    scroller.appendChild(table);
    wrapper.appendChild(addRowBtn);
    wrapper.appendChild(addColBtn);

    return {
      dom: wrapper,
      contentDOM: tbody,
      update(updatedNode) {
        if (updatedNode.type !== currentNode.type) return false;
        currentNode = updatedNode;
        syncColumns(updatedNode, colgroup, table);
        return true;
      },
      ignoreMutation(record) {
        // The resize drag writes width styles onto the table and its <col>s; they
        // aren't content edits.
        return (
          record.type === "attributes" &&
          (record.target === table || colgroup.contains(record.target))
        );
      },
    };
  },
);

/**
 * Drag-to-resize columns: prosemirror-tables' columnResizing, with
 * `View: null` so tableHoverView stays the node view.
 */
export const tableColumnResizing = $prose(() => columnResizing({ View: null }));
