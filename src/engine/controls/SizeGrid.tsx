import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import "./size-grid.css";

export interface GridSize {
  rows: number;
  cols: number;
}

interface SizeGridProps {
  /** The size now: lit on the grid, and where the keys start. */
  value: GridSize;
  least: GridSize;
  most: GridSize;
  label: string;
  /** "4 rows, 3 columns", read out as the size changes. */
  sizeText: (size: GridSize) => string;
  /** Whether the cell at row `r`, column `c` has something in it: picked
   *  smaller, those cells are marked as lost. */
  filled?: (r: number, c: number) => boolean;
  losesText?: string;
  onPick: (size: GridSize) => void;
}

const clamp = (n: number, low: number, high: number) =>
  Math.min(high, Math.max(low, n));

/** How far a press moves before it is a drag, in px. */
const SLOP = 6;

/** The mouse events a browser makes after a finger lifts land on what is
 *  under it then: the grid closed, that is the page. They are dropped. */
function swallowTapThrough() {
  const drop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const kinds = ["mousedown", "mouseup", "click"] as const;
  for (const kind of kinds) window.addEventListener(kind, drop, true);
  setTimeout(() => {
    for (const kind of kinds) window.removeEventListener(kind, drop, true);
  }, 400);
}

/** Cells of a table that a picked size would cut away and that have
 *  something in them. */
export function lostCells(
  value: GridSize,
  picked: GridSize,
  filled: (r: number, c: number) => boolean,
): number {
  let lost = 0;
  for (let r = 0; r < value.rows; r++)
    for (let c = 0; c < value.cols; c++)
      if ((r >= picked.rows || c >= picked.cols) && filled(r, c)) lost++;
  return lost;
}

/** The grid shown: one row and column past what is lit, never fewer than
 *  five by six, never past `most`. */
export function shownSize(
  value: GridSize,
  at: GridSize,
  most: GridSize,
): GridSize {
  return {
    rows: clamp(Math.max(value.rows, at.rows) + 1, 5, most.rows),
    cols: clamp(Math.max(value.cols, at.cols) + 1, 6, most.cols),
  };
}

/**
 * A table's size picked on a grid of cells: the pointer (or the arrow
 * keys) lights the size, a click (or Enter) takes it. On a touch screen a
 * finger drags across and lifts to take it.
 */
export function SizeGrid(p: SizeGridProps) {
  const [at, setAt] = useState<GridSize>(p.value);
  // The press: where it went down and the size it points at. The grid
  // grows under it (a sheet upward), so the lift picks this, not the cell
  // under the finger then.
  const pressed = useRef<{ x: number; y: number; size: GridSize } | null>(null);
  const fit = (size: GridSize): GridSize => ({
    rows: clamp(size.rows, p.least.rows, p.most.rows),
    cols: clamp(size.cols, p.least.cols, p.most.cols),
  });
  const shown = shownSize(p.value, at, p.most);
  const lost = p.filled ? lostCells(p.value, at, p.filled) : 0;

  const cellAt = (e: PointerEvent) => {
    const cell = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-cell]");
    if (!cell) return null;
    const [r, c] = cell.dataset.cell!.split(",").map(Number);
    return fit({ rows: r! + 1, cols: c! + 1 });
  };
  const follow = (e: PointerEvent) => {
    const press = pressed.current;
    if (e.pointerType !== "mouse" && !press) return;
    // A finger's tremor isn't a move.
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) < SLOP)
      return;
    const size = cellAt(e);
    if (!size) return;
    setAt(size);
    if (press) press.size = size;
  };
  const keys = (e: KeyboardEvent) => {
    const step: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const move = step[e.key];
    if (move) {
      e.preventDefault();
      setAt(fit({ rows: at.rows + move[0], cols: at.cols + move[1] }));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      p.onPick(at);
    }
  };

  const cells = [];
  for (let r = 0; r < shown.rows; r++)
    for (let c = 0; c < shown.cols; c++) {
      const now = r < p.value.rows && c < p.value.cols;
      const lit = r < at.rows && c < at.cols;
      const state = lit
        ? "is-picked"
        : now && p.filled?.(r, c)
          ? "is-lost"
          : now
            ? "is-current"
            : "";
      cells.push(
        <span key={`${r},${c}`} data-cell={`${r},${c}`} className={state} />,
      );
    }

  return (
    <div className="tx-size-grid">
      <div
        className="tx-size-grid-cells"
        role="group"
        aria-label={p.label}
        aria-description={p.sizeText(at)}
        tabIndex={0}
        style={{ gridTemplateColumns: `repeat(${shown.cols}, auto)` }}
        onKeyDown={keys}
        onPointerDown={(e) => {
          // A right or middle press opens nothing and picks nothing.
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const size = cellAt(e);
          if (size) setAt(size);
          pressed.current = { x: e.clientX, y: e.clientY, size: size ?? at };
        }}
        onPointerMove={follow}
        onPointerUp={(e) => {
          const press = pressed.current;
          if (!press) return;
          follow(e);
          pressed.current = null;
          if (e.pointerType !== "mouse") swallowTapThrough();
          p.onPick(press.size);
        }}
        onPointerCancel={() => (pressed.current = null)}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse" && !pressed.current) setAt(p.value);
        }}
      >
        {cells}
      </div>
      <div className="tx-size-grid-foot" aria-live="polite">
        <span className="tx-size-grid-size">
          {at.rows} × {at.cols}
        </span>
        {lost > 0 && p.losesText && (
          <span className="tx-size-grid-loses">{p.losesText}</span>
        )}
      </div>
    </div>
  );
}
