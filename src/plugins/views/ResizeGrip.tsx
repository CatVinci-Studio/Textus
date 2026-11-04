import { useRef } from "react";
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
  const start = useRef<{ x: number; y: number; scale: number } | null>(null);
  // Screen points: the view, or its window, moves under the pointer.
  const next = (event: React.PointerEvent) => {
    const from = start.current!;
    const dx = event.screenX - from.x;
    const inward = (side === "left" ? dx : -dx) / (width * from.scale);
    const up = (from.y - event.screenY) / (height * from.scale);
    return clampScale(from.scale * (1 + (inward + up) / 2));
  };
  return (
    <div
      className="floating-view-grip"
      data-side={side}
      aria-hidden
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.screenX, y: event.screenY, scale };
      }}
      onPointerMove={(event) => {
        if (start.current) onResize(next(event));
      }}
      onPointerUp={(event) => {
        if (!start.current) return;
        onDone(next(event));
        start.current = null;
      }}
      onPointerCancel={() => {
        start.current = null;
        onResize(scale);
      }}
    />
  );
}
