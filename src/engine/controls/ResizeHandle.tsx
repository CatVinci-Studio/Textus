import { GRIP_KEY_STEP, gripKey, useGrip } from "../frame/useGrip";
import "./resize-handle.css";

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
  const grip = useGrip({
    start: (e) => ({ startX: e.clientX, startWidth: width, last: width }),
    move: (e, held) => {
      held.last = held.startWidth + (e.clientX - held.startX) * outward;
      onResize(held.last, false);
    },
    // Let go however it ends, the width where it was.
    end: (held) => onResize(held.last, true),
  });
  return (
    <div
      className={`resize-handle tx-grip ${className}${grip.gripped ? " resize-handle-active" : ""}`}
      data-gripped={grip.gripped || undefined}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      {...grip.props}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const sign = gripKey(e.key, "row");
        if (sign) onResize(width + sign * GRIP_KEY_STEP * outward, true);
        else if (e.key === "Home") onResize(min, true);
        else if (e.key === "End") onResize(max, true);
        else return;
        e.preventDefault();
      }}
    />
  );
}
