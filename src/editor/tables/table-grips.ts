import type { EditorView } from "@milkdown/kit/prose/view";
import { trackDrag } from "../../engine/drag/pointer-drag";
import { holdToDrag } from "../../engine/drag/hold-drag";
import { passedCount, shiftAt } from "../../engine/drag/row";
import {
  CellSelection,
  moveTableColumn,
  moveTableRow,
  TableMap,
} from "@milkdown/kit/prose/tables";
import { play } from "../../engine/motion/flip";

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
    el.className = `table-grip table-grip-${axis} tx-table-grip tx-table-grip-${axis}`;
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
  /** `el`'s box in the wrapper as laid out, where the grips are placed:
   *  screen boxes inside the document's zoom differ by engine. The
   *  table's sideways scroll is taken off. */
  const box = (el: HTMLElement) => {
    let x = 0;
    let y = 0;
    for (let n: HTMLElement | null = el; n && n !== wrapper;) {
      x += n.offsetLeft;
      y += n.offsetTop;
      n = n.offsetParent as HTMLElement | null;
    }
    for (let n = el.parentElement; n && n !== wrapper; n = n.parentElement) {
      x -= n.scrollLeft;
      y -= n.scrollTop;
    }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  };

  /** The grips at `cell`'s row and column; hidden with none. */
  function place(cell: HTMLElement | null) {
    last = cell;
    const tr = cell?.parentElement;
    const row = tr ? rows().indexOf(tr as HTMLTableRowElement) : -1;
    const col = tr && cell ? [...tr.children].indexOf(cell) : -1;
    at = { row, col };
    wrapper.toggleAttribute("data-grips", row >= 0);
    // Which edges the pointer is by: each shows its own tools (the strips,
    // the toolbar over the head row), not all of them as it enters.
    const near = [
      row === 0 && "top",
      tr && row === rows().length - 1 && "bottom",
      tr && col === tr.children.length - 1 && "right",
    ].filter(Boolean);
    wrapper.dataset.near = near.join(" ");
    if (!cell || !tr || row < 0) return;
    const t = box(table);
    const r = box(tr as HTMLElement);
    const c = box(cell);
    grips.row.hidden = row === 0;
    // Scrolled sideways, the row's grip stays at the edge still shown.
    grips.row.style.transform = `translate(${Math.max(t.x, 0)}px, ${r.y + r.h / 2}px)`;
    // A column half scrolled out: its grip at the middle of what shows.
    const left = Math.max(c.x, 0);
    const right = Math.min(c.x + c.w, wrapper.clientWidth);
    grips.col.hidden = right <= left;
    grips.col.style.transform = `translate(${(left + right) / 2}px, ${t.y}px)`;
  }
  // Placed again as the table changes size (zoom, the window, a row
  // growing as it is typed in), not only as the pointer moves.
  let last: HTMLElement | null = null;
  const resized = new ResizeObserver(() => {
    if (last?.isConnected && !dragging) place(last);
  });
  resized.observe(table);

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
  const onLeave = () => {
    mouseOver = false;
    delete wrapper.dataset.near;
  };
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
    // A finger lifts it only once held, so a press there stays the
    // system's (a long press for the paste bar, a scroll).
    const touch = e.pointerType === "touch";
    if (!touch) e.preventDefault();
    // Rows: the body's, the head row staying first. Columns: the head
    // row's cells stand for theirs.
    const items =
      axis === "row"
        ? rows().slice(1)
        : ([...(rows()[0]?.children ?? [])] as HTMLElement[]);
    const from = axis === "row" ? index - 1 : index;
    // Laid-out boxes, not screen ones: the lift and the slides are drawn
    // inside the document's zoom, which scales them; the pointer's moves
    // are taken back into it.
    const zoom =
      parseFloat(
        getComputedStyle(wrapper).getPropertyValue("--content-zoom"),
      ) || 1;
    const along = (el: HTMLElement) => {
      const b = box(el);
      return axis === "row"
        ? { start: b.y, size: b.h, mid: b.y + b.h / 2 }
        : { start: b.x, size: b.w, mid: b.x + b.w / 2 };
    };
    const centers = items
      .filter((_, i) => i !== from)
      .map((el) => along(el).mid);
    const mine = along(items[from]!);
    // It stays within the others: never over the head row, or past the end.
    const first = along(items[0]!);
    const last = along(items[items.length - 1]!);
    const least = first.start - (mine.mid - mine.size / 2);
    const most = last.start + last.size - (mine.mid + mine.size / 2);
    const start = axis === "row" ? e.clientY : e.clientX;
    const scope = `.table-wrapper[data-drag-id="${id}"] tbody`;
    const place = (i: number) =>
      axis === "row"
        ? `${scope} > tr:nth-child(${i + 2})`
        : `${scope} > tr > :nth-child(${i + 1})`;
    const translate = axis === "row" ? "translateY" : "translateX";
    let to = from;
    const handlers = {
      start: () => {
        dragging = axis;
        wrapper.setAttribute("data-dragging", axis);
        wrapper.classList.add("tx-making-room");
      },
      move: (x: number, y: number) => {
        // Where it lands goes by the pointer; where it is drawn stays inside.
        const pulled = ((axis === "row" ? y : x) - start) / zoom;
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
      end: (_x: number, _y: number, dropped: boolean) => {
        // Where the lifted cells are drawn as the hand lets go.
        const cells = (i: number) => [
          ...document.querySelectorAll<HTMLElement>(
            axis === "row" ? `${place(i)} > *` : place(i),
          ),
        ];
        const held = cells(from).map((el) => el.getBoundingClientRect());
        sheet.textContent = "";
        wrapper.removeAttribute("data-dragging");
        wrapper.classList.remove("tx-making-room");
        dragging = null;
        const table = tableNow();
        const moved = !!dropped && !!table && to !== from;
        // They glide from there into their place: the new one, or home.
        const land = () => {
          const before = new Map<Element, DOMRect>();
          cells(moved ? to : from).forEach((el, i) => {
            if (held[i]) before.set(el, held[i]);
          });
          play(before, { duration: "--dur-land", easing: "--ease-land" });
        };
        if (!moved) return land();
        const offset = axis === "row" ? 1 : 0;
        // The move reads its row or column off the selection: picked first,
        // wherever the caret was.
        pick(axis, from + offset);
        const command = axis === "row" ? moveTableRow : moveTableColumn;
        command({
          from: from + offset,
          to: to + offset,
          pos: table.pos + 1,
          select: true,
        })(view.state, view.dispatch);
        land();
        view.focus();
      },
    };
    if (touch) holdToDrag(e, { lift: handlers.start, ...handlers });
    else trackDrag(e, handlers);
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
      resized.disconnect();
    },
  };
}
