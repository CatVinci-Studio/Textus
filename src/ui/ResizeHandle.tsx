import { useRef, useState } from "react";
import "./resize-handle.css";

/** How far one arrow key press moves the edge. */
const KEY_STEP = 20;

/**
 * The drag handle on a side panel's inner edge (the sidebar's right one,
 * the Agent panel's left one). `edge` is the side of the panel it sits on:
 * pulling that edge outward widens the panel, and so do the arrow key
 * pointing that way. The width follows the pointer as `onResize(w, false)`;
 * `onResize(w, true)` comes once the drag lets go, and on every key press,
 * for the caller to remember it - not on each frame of a drag. A double
 * click puts back the default (`onReset`).
 */
export function ResizeHandle({
  className,
  edge,
  width,
  min,
  max,
  onResize,
  onReset,
  label,
}: {
  className: string;
  edge: "left" | "right";
  width: number;
  min: number;
  max: number;
  onResize: (width: number, done: boolean) => void;
  onReset?: () => void;
  label: string;
}) {
  const outward = edge === "right" ? 1 : -1;
  const drag = useRef<{ startX: number; startWidth: number; last: number }>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    onResize(d.last, true);
  };
  return (
    <div
      className={`resize-handle ${className}${dragging ? " resize-handle-active" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        // Captured, so the drag (and its cursor) keeps going over the
        // editor or past the window's edge.
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startX: e.clientX, startWidth: width, last: width };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.last = d.startWidth + (e.clientX - d.startX) * outward;
        onResize(d.last, false);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") onResize(width + KEY_STEP * outward, true);
        else if (e.key === "ArrowLeft")
          onResize(width - KEY_STEP * outward, true);
        else if (e.key === "Home") onResize(min, true);
        else if (e.key === "End") onResize(max, true);
        else return;
        e.preventDefault();
      }}
    />
  );
}
