/** Where a pinch is and how far it has spread, as WebKit's gesture events
 *  tell it: `scale` from the pinch's start. */
export interface PinchAt {
  clientX: number;
  clientY: number;
  scale: number;
}

export interface PinchHandlers {
  /** False: not a pinch to take here; the touch is left as it was. */
  start(at: PinchAt): boolean;
  change(at: PinchAt): void;
  end(at: PinchAt): void;
}

function spreadOf(
  touches: TouchList,
  apart0: number,
): PinchAt & { apart: number } {
  const a = touches[0];
  const b = touches[1];
  const apart = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  return {
    apart,
    clientX: (a.clientX + b.clientX) / 2,
    clientY: (a.clientY + b.clientY) / 2,
    scale: apart0 > 0 ? apart / apart0 : 1,
  };
}

/**
 * Two fingers' pinch read from their touches, for a web view that sends
 * neither gesture events nor a ctrl+wheel for it (Android's): their
 * spread is the scale, their middle the point. Returns the unlisten.
 */
export function listenToTouchPinch(
  target: Window,
  pinch: PinchHandlers,
): () => void {
  let apart0 = 0;
  let last: PinchAt | null = null;
  const end = () => {
    if (last) pinch.end(last);
    last = null;
  };
  const onStart = (event: TouchEvent) => {
    end();
    if (event.touches.length !== 2 || event.defaultPrevented) return;
    const at = spreadOf(event.touches, 0);
    if (!(at.apart > 0)) return;
    apart0 = at.apart;
    const first = { ...at, scale: 1 };
    if (pinch.start(first)) last = first;
  };
  // Held from the start: one added with the second finger comes after
  // Chromium has made the touch's moves uncancelable.
  const onMove = (event: TouchEvent) => {
    if (!last || event.touches.length !== 2) return;
    const { apart, ...at } = spreadOf(event.touches, apart0);
    if (!(apart > 0)) return;
    if (event.cancelable) event.preventDefault();
    last = at;
    pinch.change(at);
  };
  const onEnd = (event: TouchEvent) => {
    if (event.touches.length < 2) end();
  };
  target.addEventListener("touchstart", onStart);
  target.addEventListener("touchmove", onMove, { passive: false });
  target.addEventListener("touchend", onEnd);
  target.addEventListener("touchcancel", end);
  return () => {
    target.removeEventListener("touchstart", onStart);
    target.removeEventListener("touchmove", onMove);
    target.removeEventListener("touchend", onEnd);
    target.removeEventListener("touchcancel", end);
  };
}
