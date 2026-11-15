import type { EditorView } from "@milkdown/kit/prose/view";
import { trackDrag } from "../../engine/drag/pointer-drag";
import { passedCount, shiftAt } from "../../engine/drag/row";
import {
  CellSelection,
  moveTableColumn,
  moveTableRow,
  TableMap,
} from "@milkdown/kit/prose/tables";

type Axis = "row" | "col";

/**
 * A grip at the left of the row and the top of the column under the
 * pointer (or the caret, on a phone): pressed, it picks the whole row or
 * column; pulled, it moves it, the others making room. The head row
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
    el.className = `table-grip table-grip-${axis} tx-grip tx-grip-${axis}`;
    el.contentEditable = "false";
    // A pointer's way only: the menus and keys do the same for the keyboard
    // and screen readers.
    el.tabIndex = -1;
    el.setAttribute("aria-hidden", "true");
    wrapper.append(el);
    return el;
  };
  const grips = { row: grip("row"), col: grip("col") };
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
  // A mouse over the table: the grips follow it, not the caret. A finger
  // leaves iOS's :hover stuck on, so only a mouse counts.
  let mouseOver = false;
  const onMove = (e: PointerEvent) => {
    if (dragging || e.pointerType !== "mouse") return;
    mouseOver = true;
    const cell = cellAt(e.target);
    if (cell) place(cell);
  };
  const onLeave = () => (mouseOver = false);
  wrapper.addEventListener("pointermove", onMove);
  wrapper.addEventListener("pointerleave", onLeave);

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
  // The lift and the slides are rules here, not styles on the rows and
  // cells: ProseMirror redraws a row whose attributes change.
  const sheet = wrapper.appendChild(document.createElement("style"));
  const id = `t${Math.random().toString(36).slice(2, 8)}`;
  wrapper.dataset.dragId = id;
  /**
   * The row (below the head) or column under the grip, pulled: it follows
   * the pointer lifted, the others make room as it passes them (the
   * sidebar tabs' way, engine/drag); let go, it moves there.
   */
  function drag(axis: Axis, e: PointerEvent) {
    const index = axis === "row" ? at.row : at.col;
    if (index < 0 || (axis === "row" && index < 1)) return;
    e.preventDefault();
    // Rows: the body's, the head row staying first. Columns: the head
    // row's cells stand for theirs.
    const items =
      axis === "row"
        ? rows().slice(1)
        : ([...(rows()[0]?.children ?? [])] as HTMLElement[]);
    const from = axis === "row" ? index - 1 : index;
    const along = (el: Element) => {
      const r = el.getBoundingClientRect();
      return axis === "row"
        ? { mid: r.top + r.height / 2, size: r.height }
        : { mid: r.left + r.width / 2, size: r.width };
    };
    const centers = items
      .filter((_, i) => i !== from)
      .map((el) => along(el).mid);
    const mine = along(items[from]!);
    // It stays within the others: never over the head row, or past the end.
    const first = items[0]!.getBoundingClientRect();
    const last = items[items.length - 1]!.getBoundingClientRect();
    const reach =
      axis === "row" ? [first.top, last.bottom] : [first.left, last.right];
    const least = reach[0]! - (mine.mid - mine.size / 2);
    const most = reach[1]! - (mine.mid + mine.size / 2);
    const start = axis === "row" ? e.clientY : e.clientX;
    const scope = `.table-wrapper[data-drag-id="${id}"] tbody`;
    const place = (i: number) =>
      axis === "row"
        ? `${scope} > tr:nth-child(${i + 2})`
        : `${scope} > tr > :nth-child(${i + 1})`;
    const translate = axis === "row" ? "translateY" : "translateX";
    let to = from;
    trackDrag(e, {
      start: () => {
        dragging = axis;
        wrapper.setAttribute("data-dragging", axis);
        wrapper.classList.add("tx-making-room");
      },
      move: (x, y) => {
        // Where it lands goes by the pointer; where it is drawn stays inside.
        const pulled = (axis === "row" ? y : x) - start;
        to = passedCount(centers, mine.mid + pulled);
        const shift = Math.min(most, Math.max(least, pulled));
        const lifted = axis === "row" ? `${place(from)} > *` : place(from);
        const rules = [
          `${place(from)} { transform: ${translate}(${shift}px); position: relative; z-index: 2; transition: none; }`,
          `${lifted} { background: var(--doc-bg, var(--ui-bg)); box-shadow: var(--shadow-popover); }`,
        ];
        let other = 0;
        items.forEach((_, i) => {
          if (i === from) return;
          const by = shiftAt(other++, from, to, mine.size);
          if (by)
            rules.push(`${place(i)} { transform: ${translate}(${by}px); }`);
        });
        sheet.textContent = rules.join("\n");
      },
      end: (_x, _y, dropped) => {
        sheet.textContent = "";
        wrapper.removeAttribute("data-dragging");
        wrapper.classList.remove("tx-making-room");
        dragging = null;
        const table = tableNow();
        if (!dropped || !table || to === from) return;
        const offset = axis === "row" ? 1 : 0;
        const command = axis === "row" ? moveTableRow : moveTableColumn;
        command({
          from: from + offset,
          to: to + offset,
          pos: table.pos + 1,
          select: true,
        })(view.state, view.dispatch);
        view.focus();
      },
    });
  }
  for (const axis of ["row", "col"] as const) {
    grips[axis].addEventListener("pointerdown", (e) => drag(axis, e));
    // Pressed without a pull: the whole row or column is picked.
    grips[axis].addEventListener("click", () =>
      pick(axis, axis === "row" ? at.row : at.col),
    );
  }

  return {
    /** The grips follow the caret where there is no pointer (a phone). */
    follow(caretCell: HTMLElement | null) {
      if (!dragging && !mouseOver) place(caretCell);
    },
    destroy() {
      wrapper.removeEventListener("pointermove", onMove);
      wrapper.removeEventListener("pointerleave", onLeave);
    },
  };
}
