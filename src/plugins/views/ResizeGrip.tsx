import { useGrip } from "../../engine/frame/useGrip";
import { clampScale } from "./floating-views";

/**
 * The corner a floating view is resized by: the top one toward the middle,
 * so it grows away from the edge it sits against, in proportion. Shown
 * while the pointer is over the view.
 */
export function ResizeGrip({
  side,
  scale,
  width,
  height,
  onResize,
  onDone,
}: {
  side: "left" | "right";
  scale: number;
  /** The manifest's size, at scale 1. */
  width: number;
  height: number;
  onResize: (scale: number) => void;
  onDone: (scale: number) => void;
}) {
  // Screen points: the view, or its window, moves under the pointer.
  const next = (
    event: React.PointerEvent,
    from: { x: number; y: number; scale: number },
  ) => {
    const dx = event.screenX - from.x;
    const inward = (side === "left" ? dx : -dx) / (width * from.scale);
    const up = (from.y - event.screenY) / (height * from.scale);
    return clampScale(from.scale * (1 + (inward + up) / 2));
  };
  const grip = useGrip({
    start: (event) => {
      event.stopPropagation();
      return { x: event.screenX, y: event.screenY, scale, last: scale };
    },
    move: (event, held) => {
      held.last = next(event, held);
      onResize(held.last);
    },
    end: (held, how) => {
      if (how === "cancelled") onResize(scale);
      else onDone(held.last);
    },
  });
  return (
    <div
      className="floating-view-grip"
      data-side={side}
      aria-hidden
      {...grip.props}
    />
  );
}
