import { useEffect, useRef } from "react";
import { onFlush } from "../storage/pending-writes";
import { blockAt, holdBlock } from "../ui/hold-line";
import { listenToThisWindow, unlistenAll } from "../platform/events";

/// Document zoom, scoped to the editor content; the window chrome stays at
/// 100%. Published as `--content-zoom`, so fixed overlays keep unzoomed
/// coordinates. Fed by trackpad pinch, mod+wheel and the View menu.

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
/// Multiplicative step for the menu/keyboard Zoom In/Out items.
const MENU_STEP = 1.1;
/// Trailing delay before persisting, so only the resting value is saved.
const PERSIST_DELAY_MS = 400;

/// WebKit's proprietary pinch events (gesturestart/change/end) - not in
/// lib.dom because no other engine implements them.
interface WebKitGestureEvent extends UIEvent {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

function clamp(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/// Snaps near-100% values to exactly 1, so text isn't left blurry at 98%.
function snap(zoom: number): number {
  const clamped = clamp(zoom);
  return Math.abs(clamped - 1) < 0.03 ? 1 : clamped;
}

/// Where a zoom step is held still: a rendered scroller, or a source
/// textarea, which scrolls itself.
type Pane =
  | { kind: "rendered"; scroller: HTMLElement; content: Element }
  | { kind: "source"; scroller: HTMLTextAreaElement };

/// The pane under the pointer, else the focused one, else the first on
/// screen. Split panes sit side by side, hence the x.
function zoomPane(x: number | null, y: number | null): Pane | null {
  const tab = '[data-active-tab="true"]';
  const panes: Pane[] = [];
  for (const selector of [`${tab} .editor-scroll`, `${tab} .split-preview`]) {
    const scroller = document.querySelector<HTMLElement>(selector);
    const content = scroller?.querySelector(".milkdown");
    if (scroller && content)
      panes.push({ kind: "rendered", scroller, content });
  }
  const source = document.querySelector<HTMLTextAreaElement>(
    `${tab} textarea.source-view`,
  );
  if (source) panes.push({ kind: "source", scroller: source });
  const shown = panes.filter((pane) => {
    const box = pane.scroller.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  });
  const under = (pane: Pane) => {
    const box = pane.scroller.getBoundingClientRect();
    return (
      (x === null || (x >= box.left && x <= box.right)) &&
      y !== null &&
      y >= box.top &&
      y <= box.bottom
    );
  };
  return (
    shown.find(under) ??
    shown.find((pane) => pane.scroller.contains(document.activeElement)) ??
    shown[0] ??
    null
  );
}

/// Keeps the line at viewport y `line` in place: the block under it keeps
/// its share of its height. Scaling the offset alone drifts as text rewraps.
function holdRendered(
  { scroller, content }: { scroller: HTMLElement; content: Element },
  line: number,
  prev: number,
  next: number,
  setZoomVar: () => void,
) {
  const blocks = content.querySelector(".ProseMirror");
  const block = blocks && blockAt(blocks, line);
  if (block) {
    holdBlock(scroller, block, line, setZoomVar);
    return;
  }
  // Below the last block: the column's padding is outside the zoomed node,
  // so only the distance INTO the content scales.
  const top = scroller.getBoundingClientRect().top;
  const anchor = line - top;
  const contentTop = () =>
    content.getBoundingClientRect().top - top + scroller.scrollTop;
  const before = contentTop();
  const into = Math.max(0, scroller.scrollTop + anchor - before);
  setZoomVar();
  scroller.scrollTop = contentTop() + (into * next) / prev - anchor;
}

/// The same for a source textarea, which scrolls in zoomed px. Its lines
/// rewrap, so the anchor keeps its share of the whole text height.
function holdSource(
  source: HTMLTextAreaElement,
  line: number,
  prev: number,
  next: number,
  setZoomVar: () => void,
) {
  const anchor = line - source.getBoundingClientRect().top;
  const share =
    (source.scrollTop + anchor / prev) / Math.max(1, source.scrollHeight);
  setZoomVar();
  source.scrollTop = share * source.scrollHeight - anchor / next;
}

/**
 * Applies `initialZoom` on mount and owns every zoom input for this window.
 * The live value is a ref, since pinch updates arrive per frame; `persist`
 * gets it once it comes to rest.
 */
export function useZoom(initialZoom: number, persist: (zoom: number) => void) {
  const zoomRef = useRef(snap(initialZoom));
  const persistRef = useRef(persist);
  persistRef.current = persist;

  useEffect(() => {
    let raf = 0;
    let persistTimer: ReturnType<typeof setTimeout> | undefined;
    // The viewport point the next apply holds still (null: the focused
    // pane's centre).
    let appliedZoom = 1;
    let anchorClientX: number | null = null;
    let anchorClientY: number | null = null;

    const apply = () => {
      const next = zoomRef.current;
      const prev = appliedZoom;
      appliedZoom = next;
      const setZoomVar = () =>
        document.documentElement.style.setProperty(
          "--content-zoom",
          String(next),
        );
      // Zoom leaves scrollTop alone, so without this the text under the
      // pointer slides with every step.
      const pane =
        prev === next ? null : zoomPane(anchorClientX, anchorClientY);
      if (!pane) {
        setZoomVar();
        return;
      }
      const box = pane.scroller.getBoundingClientRect();
      const line = Math.min(
        box.bottom,
        Math.max(box.top, anchorClientY ?? box.top + box.height / 2),
      );
      if (pane.kind === "source")
        holdSource(pane.scroller, line, prev, next, setZoomVar);
      else holdRendered(pane, line, prev, next, setZoomVar);
      // Split panes sync on scroll, and the held pane may not have moved:
      // let the other follow it.
      if (pane.scroller.closest(".split-view"))
        pane.scroller.dispatchEvent(new Event("scroll"));
    };

    const applyFrame = () => {
      raf = 0;
      apply();
    };

    // Saves a pending zoom, from the timer or when the window closes.
    const persistNow = () => {
      if (persistTimer === undefined) return;
      clearTimeout(persistTimer);
      persistTimer = undefined;
      persistRef.current(zoomRef.current);
    };
    const unregisterFlush = onFlush(persistNow);

    // `snapped: false` mid-pinch, so the 100% snap zone doesn't feel sticky.
    const setZoom = (
      zoom: number,
      snapped = true,
      point: { clientX: number; clientY: number } | null = null,
    ) => {
      anchorClientX = point?.clientX ?? null;
      anchorClientY = point?.clientY ?? null;
      zoomRef.current = snapped ? snap(zoom) : clamp(zoom);
      if (!raf) raf = requestAnimationFrame(applyFrame);
      clearTimeout(persistTimer);
      persistTimer = setTimeout(persistNow, PERSIST_DELAY_MS);
    };

    // The restored zoom is the starting state, not a step to anchor.
    if (zoomRef.current !== 1) {
      appliedZoom = zoomRef.current;
      document.documentElement.style.setProperty(
        "--content-zoom",
        String(zoomRef.current),
      );
    }

    // Trackpad pinch: scale is cumulative from the gesture's start, so the
    // zoom at gesturestart is the base it multiplies.
    let pinchBase = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      pinchBase = zoomRef.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const { scale } = e as WebKitGestureEvent;
      if (scale > 0) setZoom(pinchBase * scale, false, e as WebKitGestureEvent);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      setZoom(zoomRef.current, true, e as WebKitGestureEvent);
    };

    // mod+wheel zoom. Exponential, so steps are proportional to the current
    // level. Chromium reports trackpad pinch as ctrl+wheel too.
    const onWheel = (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      setZoom(zoomRef.current * Math.exp(-e.deltaY * 0.0015), true, e);
    };

    window.addEventListener("gesturestart", onGestureStart);
    window.addEventListener("gesturechange", onGestureChange);
    window.addEventListener("gestureend", onGestureEnd);
    window.addEventListener("wheel", onWheel, { passive: false });

    const unlistenMenu = unlistenAll(
      listenToThisWindow("menu-zoom-in", () =>
        setZoom(zoomRef.current * MENU_STEP),
      ),
      listenToThisWindow("menu-zoom-out", () =>
        setZoom(zoomRef.current / MENU_STEP),
      ),
      listenToThisWindow("menu-zoom-reset", () => setZoom(1)),
    );

    return () => {
      window.removeEventListener("gesturestart", onGestureStart);
      window.removeEventListener("gesturechange", onGestureChange);
      window.removeEventListener("gestureend", onGestureEnd);
      window.removeEventListener("wheel", onWheel);
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(persistTimer);
      unregisterFlush();
      unlistenMenu();
    };
    // Mount-only: everything reactive comes in through the refs above.
  }, []);
}
