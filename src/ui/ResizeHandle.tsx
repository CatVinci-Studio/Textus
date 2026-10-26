import { useRef, useState } from "react";
import "./resize-handle.css";

const KEY_STEP = 20;

/** The drag handle on a side panel's inner edge. `onResize(w, false)` follows
 *  the pointer; `onResize(w, true)` comes on release and each key press, for
 *  the caller to remember. */
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
