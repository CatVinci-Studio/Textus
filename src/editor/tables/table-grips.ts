import type { EditorView } from "@milkdown/kit/prose/view";
import { scaledPx } from "../../engine/tokens/chrome-scale";
import {
  CellSelection,
  moveTableColumn,
  moveTableRow,
  TableMap,
} from "@milkdown/kit/prose/tables";

/** How far a grip is pulled before it drags rather than selects. */
const DRAG_PX = 4;

type Axis = "row" | "col";

/** Where a row or column lands when let go at `at` along `axis`: the
 *  index it takes, by the middles of the others. */
export function dropIndex(
  middles: readonly number[],
  at: number,
  from: number,
): number {
  let slot = middles.findIndex((m) => at < m);
  if (slot === -1) slot = middles.length;
  return slot > from ? slot - 1 : slot;
}

/**
 * A grip at the left of the row and the top of the column under the
 * pointer (or the caret, on a phone): pressed, it picks the whole row or
 * column; pulled, it moves it, a line showing where it lands. The head row
 * stays first: it has no grip, and nothing lands above it.
 */
export function attachGrips(options: {
  wrapper: HTMLElement;
  table: HTMLTableElement;
  tbody: HTMLElement;
  view: EditorView;
  getPos: () => number | undefined;
}) {
  const { wrapper, table, tbody, view, getPos } = options;
  const grip = (axis: Axis) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `table-grip table-grip-${axis}`;
    el.contentEditable = "false";
    // A pointer's way only: the menus and keys do the same for the keyboard
    // and screen readers.
    el.tabIndex = -1;
    el.setAttribute("aria-hidden", "true");
    wrapper.append(el);
    return el;
  };
  const grips = { row: grip("row"), col: grip("col") };
  const band = wrapper.appendChild(document.createElement("div"));
  band.className = "table-drag-band";
  const line = wrapper.appendChild(document.createElement("div"));
  line.className = "table-drop-line";
  let at = { row: -1, col: -1 };

  const rows = () => [...tbody.children] as HTMLTableRowElement[];
  const box = (el: Element) => {
    const r = el.getBoundingClientRect();
    const w = wrapper.getBoundingClientRect();
    return { x: r.left - w.left, y: r.top - w.top, w: r.width, h: r.height };
  };

  /** The grips at `cell`'s row and column; hidden with none. */
  function place(cell: HTMLElement | null) {
    const tr = cell?.parentElement;
    const row = tr ? rows().indexOf(tr as HTMLTableRowElement) : -1;
    const col = tr && cell ? [...tr.children].indexOf(cell) : -1;
    at = { row, col };
    wrapper.toggleAttribute("data-grips", row >= 0);
    if (!cell || !tr || row < 0) return;
    const t = box(table);
    const r = box(tr);
    const c = box(cell);
    grips.row.hidden = row === 0;
    grips.row.style.transform = `translate(${t.x}px, ${r.y + r.h / 2}px)`;
    grips.col.style.transform = `translate(${c.x + c.w / 2}px, ${t.y}px)`;
  }

  const cellAt = (target: EventTarget | null) => {
    const cell = (target as Element | null)?.closest?.("td, th");
    return cell && tbody.contains(cell) ? (cell as HTMLElement) : null;
  };
  const onMove = (e: PointerEvent) => {
    if (dragging) return;
    const cell = cellAt(e.target);
    if (cell) place(cell);
  };
  wrapper.addEventListener("pointermove", onMove);

  /** The table's start and its map, while it is in the document. */
  const tableNow = () => {
    const pos = getPos();
    const node = pos == null ? null : view.state.doc.nodeAt(pos);
    return pos == null || !node ? null : { pos, node, map: TableMap.get(node) };
  };

  function pick(axis: Axis, index: number) {
    const t = tableNow();
    if (!t) return;
    const cell = (row: number, col: number) =>
      t.pos + 1 + t.map.positionAt(row, col, t.node);
    const [first, last] =
      axis === "row"
        ? [cell(index, 0), cell(index, t.map.width - 1)]
        : [cell(0, index), cell(t.map.height - 1, index)];
    view.dispatch(
      view.state.tr.setSelection(
        CellSelection.create(view.state.doc, first, last),
      ),
    );
    view.focus();
  }

  let dragging: Axis | null = null;
  function drag(axis: Axis, e: PointerEvent) {
    const from = axis === "row" ? at.row : at.col;
    if (from < 0 || e.button !== 0) return;
    e.preventDefault();
    const el = grips[axis];
    el.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };
    // The rows (below the head) or the columns, as laid out now.
    const parts =
      axis === "row"
        ? rows()
        : ([...(rows()[0]?.children ?? [])] as HTMLElement[]);
    const boxes = parts.map(box);
    const middles = boxes.map((b) =>
      axis === "row" ? b.y + b.h / 2 : b.x + b.w / 2,
    );
    const t = box(table);
    let to = from;
    const move = (ev: PointerEvent) => {
      const along =
        axis === "row" ? ev.clientY - start.y : ev.clientX - start.x;
      if (!dragging && Math.abs(along) < scaledPx(DRAG_PX)) return;
      dragging = axis;
      wrapper.setAttribute("data-dragging", axis);
      const w = wrapper.getBoundingClientRect();
      const point = axis === "row" ? ev.clientY - w.top : ev.clientX - w.left;
      to = dropIndex(middles, point, from);
      // Nothing lands above the head row.
      if (axis === "row") to = Math.max(1, to);
      const b = boxes[from]!;
      band.style.transform = `translate(${b.x}px, ${b.y}px)`;
      band.style.width = `${b.w}px`;
      band.style.height = `${b.h}px`;
      const edge = boxes[to]!;
      const lineAt =
        axis === "row"
          ? to > from
            ? edge.y + edge.h
            : edge.y
          : to > from
            ? edge.x + edge.w
            : edge.x;
      line.style.transform =
        axis === "row"
          ? `translate(${t.x}px, ${lineAt}px)`
          : `translate(${lineAt}px, ${t.y}px)`;
      line.style.width = axis === "row" ? `${t.w}px` : "";
      line.style.height = axis === "row" ? "" : `${t.h}px`;
    };
    const end = (ev: PointerEvent | null) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      wrapper.removeAttribute("data-dragging");
      const moved = dragging;
      dragging = null;
      if (!ev) return;
      if (!moved) return pick(axis, from);
      const table = tableNow();
      if (!table || to === from) return;
      const command = axis === "row" ? moveTableRow : moveTableColumn;
      command({ from, to, pos: table.pos + 1, select: true })(
        view.state,
        view.dispatch,
      );
      view.focus();
    };
    const up = (ev: PointerEvent) => end(ev);
    const cancel = () => end(null);
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      end(null);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
  }
  grips.row.addEventListener("pointerdown", (e) => drag("row", e));
  grips.col.addEventListener("pointerdown", (e) => drag("col", e));

  return {
    /** The grips follow the caret where there is no pointer (a phone). */
    follow(caretCell: HTMLElement | null) {
      if (!dragging && !wrapper.matches(":hover")) place(caretCell);
    },
    destroy() {
      wrapper.removeEventListener("pointermove", onMove);
    },
  };
}
