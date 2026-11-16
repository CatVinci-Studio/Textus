import type { EditorView } from "@milkdown/kit/prose/view";
import {
  columnResizingPluginKey,
  TableMap,
  updateColumnsOnResize,
} from "@milkdown/kit/prose/tables";
import { trackDrag } from "../../engine/drag/pointer-drag";

/** prosemirror-tables' columnResizing least width for a dragged column. */
const LEAST = 25;

/**
 * A column's edge dragged: its width follows the pointer, taken back into
 * the document's zoom (prosemirror-tables adds screen pixels to a laid-out
 * width, so at 125% the edge ran ahead of the pointer). columnResizing still
 * finds the edge and draws it; the drag is this one. `cellPos` is the cell
 * left of the edge.
 */
export function dragColumnEdge(
  view: EditorView,
  cellPos: number,
  down: MouseEvent,
  defaultCellMinWidth: number,
): void {
  const $cell = view.state.doc.resolve(cellPos);
  const cell = $cell.nodeAfter;
  const start = $cell.start(-1);
  if (!cell) return;
  const col =
    TableMap.get($cell.node(-1)).colCount(cellPos - start) +
    (cell.attrs.colspan as number) -
    1;
  let dom: Node | null = view.domAtPos(start).node;
  while (dom && dom.nodeName !== "TABLE") dom = dom.parentNode;
  const table = dom as HTMLTableElement | null;
  const colgroup = table?.querySelector("colgroup");
  if (!table || !colgroup) return;
  const zoom =
    parseFloat(getComputedStyle(table).getPropertyValue("--content-zoom")) || 1;
  const widths = cell.attrs.colwidth as number[] | null;
  const cellDom = view.nodeDOM(cellPos) as HTMLElement | null;
  const from =
    widths?.at(-1) ||
    (cellDom?.offsetWidth ?? 0) / ((cell.attrs.colspan as number) || 1);
  const width = (x: number) =>
    Math.round(Math.max(LEAST, from + (x - down.clientX) / zoom));
  const node = () => view.state.doc.resolve(cellPos).node(-1);
  const draw = (w?: number) =>
    updateColumnsOnResize(
      node(),
      colgroup,
      table,
      defaultCellMinWidth,
      w === undefined ? undefined : col,
      w,
    );
  // Held as columnResizing's own drag, so its edge stays on this column.
  const holding = (dragging: unknown) =>
    view.dispatch(
      view.state.tr.setMeta(columnResizingPluginKey, { setDragging: dragging }),
    );
  holding({ startX: down.clientX, startWidth: from });
  trackDrag(
    down,
    {
      move: (x) => draw(width(x)),
      end: (x, _y, dropped) => {
        holding(null);
        if (dropped) setColumnWidth(view, cellPos, col, width(x));
        else draw();
      },
    },
    { started: true },
  );
}

/** Every cell of column `col` in the table holding `cellPos` takes `width`. */
function setColumnWidth(
  view: EditorView,
  cellPos: number,
  col: number,
  width: number,
) {
  const $cell = view.state.doc.resolve(cellPos);
  const table = $cell.node(-1);
  const start = $cell.start(-1);
  const map = TableMap.get(table);
  const tr = view.state.tr;
  for (let row = 0; row < map.height; row++) {
    const i = row * map.width + col;
    if (row && map.map[i] === map.map[i - map.width]) continue;
    const pos = map.map[i]!;
    const attrs = table.nodeAt(pos)!.attrs;
    const span = (attrs.colspan as number) || 1;
    const index = span === 1 ? 0 : col - map.colCount(pos);
    const colwidth = (attrs.colwidth as number[] | null)?.slice() ?? [];
    while (colwidth.length < span) colwidth.push(0);
    if (colwidth[index] === width) continue;
    colwidth[index] = width;
    tr.setNodeMarkup(start + pos, null, { ...attrs, colwidth });
  }
  if (tr.docChanged) view.dispatch(tr);
}
