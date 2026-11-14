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
  const pressed = useRef(false);
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
    if (e.pointerType !== "mouse" && !pressed.current) return;
    const size = cellAt(e);
    if (size) setAt(size);
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
          pressed.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          follow(e);
        }}
        onPointerMove={follow}
        onPointerUp={(e) => {
          if (!pressed.current) return;
          pressed.current = false;
          const size = cellAt(e);
          if (size) p.onPick(size);
        }}
        onPointerCancel={() => (pressed.current = false)}
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
