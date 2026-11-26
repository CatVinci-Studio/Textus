import { GRIP_KEY_STEP, gripKey, useGrip } from "../frame/useGrip";
import "./resize-handle.css";

/** The drag handle on a panel's edge that sizes it: a side panel's inner
 *  edge (its width), or a box's top (its height, the AI's composer).
 *  `onResize(size, false)` follows the pointer; `onResize(size, true)`
 *  comes on release and each key press, for the caller to remember. */
export function ResizeHandle({
  className,
  edge,
  size,
  min,
  max,
  onResize,
  onReset,
  label,
}: {
  className: string;
  /** The edge it lies on: dragged away from the box, the box grows. */
  edge: "left" | "right" | "top";
  size: number;
  min: number;
  max: number;
  onResize: (size: number, done: boolean) => void;
  onReset?: () => void;
  label: string;
}) {
  const outward = edge === "right" ? 1 : -1;
  const across = edge === "top";
  const at = (e: { clientX: number; clientY: number }) =>
    across ? e.clientY : e.clientX;
  const grip = useGrip({
    start: (e) => ({ startAt: at(e), startSize: size, last: size }),
    move: (e, held) => {
      held.last = held.startSize + (at(e) - held.startAt) * outward;
      onResize(held.last, false);
    },
    // Let go, the size where it was; cancelled, the one it started at.
    end: (held, how) =>
      onResize(how === "cancelled" ? held.startSize : held.last, true),
  });
  return (
    <div
      className={`resize-handle tx-grip ${className}${grip.gripped ? " resize-handle-active" : ""}`}
      data-gripped={grip.gripped || undefined}
      data-edge={edge}
      role="separator"
      aria-orientation={across ? "horizontal" : "vertical"}
      aria-label={label}
      aria-valuenow={Math.round(size)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      {...grip.props}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const sign = gripKey(e.key, across ? "column" : "row");
        if (sign) onResize(size + sign * GRIP_KEY_STEP * outward, true);
        else if (e.key === "Home") onResize(min, true);
        else if (e.key === "End") onResize(max, true);
        else return;
        e.preventDefault();
      }}
    />
  );
}
