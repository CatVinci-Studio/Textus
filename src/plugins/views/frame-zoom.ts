/**
 * Plugin pages and the document's zoom. A pinch or mod+wheel over a page
 * comes out of its frame and zooms as anywhere else; a page drawn in the
 * document is kept out of the CSS zoom (plugin-code-blocks.css), where
 * WebKit lays a frame out at the wrong width and draws it blurred, and is
 * told the zoom to draw at instead (contentZoom, in tab-zoom.ts).
 */

interface Point {
  x?: unknown;
  y?: unknown;
}

/** Where in the window a point of `frame`'s page is. */
function inWindow(frame: HTMLElement, at: Point) {
  const box = frame.getBoundingClientRect();
  return {
    clientX: box.left + (typeof at.x === "number" ? at.x : 0),
    clientY: box.top + (typeof at.y === "number" ? at.y : 0),
  };
}

/** A page's mod+wheel, as the window's own. */
export function passZoomWheel(
  frame: HTMLElement,
  params: Point & { deltaY?: unknown; ctrlKey?: unknown; metaKey?: unknown },
): void {
  window.dispatchEvent(
    new WheelEvent("wheel", {
      ...inWindow(frame, params),
      deltaY: typeof params.deltaY === "number" ? params.deltaY : 0,
      ctrlKey: params.ctrlKey === true,
      metaKey: params.metaKey === true,
      cancelable: true,
    }),
  );
}

const GESTURES = new Set(["gesturestart", "gesturechange", "gestureend"]);

/** A page's pinch (WebKit's gesture events), as the window's own. */
export function passZoomGesture(
  frame: HTMLElement,
  params: Point & { type?: unknown; scale?: unknown },
): void {
  if (typeof params.type !== "string" || !GESTURES.has(params.type)) return;
  const event = new Event(params.type, { cancelable: true });
  Object.assign(event, {
    ...inWindow(frame, params),
    scale: typeof params.scale === "number" ? params.scale : 1,
  });
  window.dispatchEvent(event);
}
