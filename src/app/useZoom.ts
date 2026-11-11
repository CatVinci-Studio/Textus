import { tabElement } from "../engine/layout/tab-element";
import { useEffect, useRef } from "react";
import { onFlush } from "../storage/pending-writes";
import { blockAt, holdBlock } from "../engine/controls/hold-line";
import { listenToThisWindow, unlistenAll } from "../platform/events";
import type { EditorView } from "@codemirror/view";
import { sourceViewAt } from "../editor/modes/source-view-registry";
import { CONTENT_ZOOM_EVENT, contentZoom } from "../plugins/views/frame-zoom";
import { clearTabZooms, setTabZoom, tabZoom } from "../engine/zoom/tab-zoom";

/// Document zoom, each tab its own (or, with zoomTogether, all documents
/// one), scoped to the editor content; the window chrome stays at 100%. Published as `--content-zoom` on the tab's own
/// element (the window's default on the root, for tabs not zoomed yet).
/// Fed by trackpad pinch, mod+wheel and the View menu; a tab that shows no
/// document (Settings, an AI conversation, a plugin's page) isn't zoomed.

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
/// Multiplicative step for the menu/keyboard Zoom In/Out items.
const MENU_STEP = 1.1;
/// Wheel events this close together are one gesture: a scroll's own carry
/// on as a scroll, whatever key goes down meanwhile.
const SCROLL_GESTURE_MS = 250;
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

/// Where a zoom step is held still: a rendered scroller, or the source
/// editor's own scroller.
type Pane =
  | { kind: "rendered"; scroller: HTMLElement; content: Element }
  | { kind: "source"; scroller: HTMLElement };

/// The tab a zoom is for: the one under the pointer, else the one in use;
/// null when it shows no document.
function zoomTab(x: number | null, y: number | null): HTMLElement | null {
  const under =
    x !== null && y !== null
      ? document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-tab-id]")
      : null;
  const tab = under ?? tabElement();
  return tab?.querySelector(".editor-scroll, .source-view") ? tab : null;
}

/// In `tab`: the pane under the pointer, else the focused one, else the
/// first on screen. Split view's panes sit side by side, hence the x.
function zoomPane(
  tab: HTMLElement,
  x: number | null,
  y: number | null,
): Pane | null {
  const panes: Pane[] = [];
  for (const selector of [".editor-scroll", ".split-preview"]) {
    const scroller = tab.querySelector<HTMLElement>(selector);
    const content = scroller?.querySelector(".milkdown");
    if (scroller && content)
      panes.push({ kind: "rendered", scroller, content });
  }
  const source = tab.querySelector<HTMLElement>(".source-view .cm-scroller");
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

/// The same for the source editor's scroller, whose text grows by its font
/// size (the pane isn't zoomed). CodeMirror keeps a line of its own still
/// while heights change and only knows the new ones once it measures, so
/// the line under the pointer is handed to it to put back.
function holdSource(
  source: HTMLElement,
  line: number,
  prev: number,
  next: number,
  setZoomVar: () => void,
) {
  const host = source.closest<HTMLElement>(".source-view");
  const cm = host?.parentElement && sourceViewAt(host.parentElement)?.view;
  if (!cm) return setZoomVar();
  // Steps that come before CodeMirror has measured keep the first one's
  // anchor: until then its heights are the old zoom's.
  let held = heldSource.get(source);
  if (!held) {
    const block = cm.lineBlockAtHeight(line - cm.documentTop);
    held = {
      pos: block.from,
      into: line - cm.documentTop - block.top,
      line,
      zoom: prev,
    };
    heldSource.set(source, held);
    cm.requestMeasure({
      read: () => null,
      write: () => heldSource.delete(source),
    });
  }
  setZoomVar();
  const scroll = (cm.constructor as typeof EditorView).scrollIntoView;
  cm.dispatch({
    effects: scroll(held.pos, {
      y: "start",
      yMargin:
        held.line -
        source.getBoundingClientRect().top -
        (held.into * next) / held.zoom,
    }),
  });
}

/** A source pane's anchor while a zoom waits for CodeMirror's measure. */
const heldSource = new WeakMap<
  HTMLElement,
  { pos: number; into: number; line: number; zoom: number }
>();

/**
 * Applies `initialZoom` on mount and owns every zoom input for this window.
 * The live value is a ref, since pinch updates arrive per frame; `persist`
 * gets it once it comes to rest.
 */
export function useZoom(
  initialZoom: number,
  persist: (zoom: number) => void,
  /** Every document zoomed together (settings.zoomTogether). */
  together: boolean,
) {
  const zoomRef = useRef(snap(initialZoom));
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const togetherRef = useRef(together);
  togetherRef.current = together;

  // Turned on: every document takes the window's one zoom.
  useEffect(() => {
    if (!together) return;
    clearTabZooms();
    window.dispatchEvent(new Event(CONTENT_ZOOM_EVENT));
  }, [together]);

  useEffect(() => {
    let raf = 0;
    let persistTimer: ReturnType<typeof setTimeout> | undefined;
    // The viewport point the next apply holds still (null: the focused
    // pane's centre).
    let anchorClientX: number | null = null;
    let anchorClientY: number | null = null;
    // The tab the next apply zooms, and to what.
    let target: HTMLElement | null = null;

    const apply = () => {
      const tab = target;
      if (!tab) return;
      const next = zoomRef.current;
      const prev = contentZoom(tab);
      const setZoomVar = () => {
        // Together: the window's own zoom, which every document reads.
        if (togetherRef.current)
          document.documentElement.style.setProperty(
            "--content-zoom",
            String(next),
          );
        else setTabZoom(tab.dataset.tabId!, next);
        window.dispatchEvent(new Event(CONTENT_ZOOM_EVENT));
      };
      // Zoom leaves scrollTop alone, so without this the text under the
      // pointer slides with every step.
      const pane =
        prev === next ? null : zoomPane(tab, anchorClientX, anchorClientY);
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
      if (!pane.scroller.closest(".split-view")) return;
      const held = pane.scroller.scrollTop;
      pane.scroller.dispatchEvent(new Event("scroll"));
      // The follower writes back through the same handler when its own
      // reflow moves it - CodeMirror re-measures after a resize and shifts
      // its scrollTop, so the position the sync expects is not the one it
      // finds and the pane under the pointer gets pulled with it. One frame
      // later, put that pane back where the step left it and let the other
      // follow again.
      requestAnimationFrame(() => {
        if (pane.scroller.scrollTop === held) return;
        pane.scroller.scrollTop = held;
        pane.scroller.dispatchEvent(new Event("scroll"));
      });
    };

    const applyFrame = () => {
      raf = 0;
      apply();
    };

    // Saves a pending zoom, from the timer or when the window closes: the
    // zoom new tabs start at. Tabs on the old default keep it.
    const persistNow = () => {
      if (persistTimer === undefined) return;
      clearTimeout(persistTimer);
      persistTimer = undefined;
      const root = document.documentElement;
      const was = contentZoom(root);
      for (const tab of document.querySelectorAll<HTMLElement>("[data-tab-id]"))
        if (tabZoom(tab.dataset.tabId!) === undefined)
          setTabZoom(tab.dataset.tabId!, was);
      root.style.setProperty("--content-zoom", String(zoomRef.current));
      persistRef.current(zoomRef.current);
    };
    const unregisterFlush = onFlush(persistNow);

    // `snapped: false` mid-pinch, so the 100% snap zone doesn't feel sticky.
    // `to` the zoom from the tab's own; `tab` fixed for a pinch's gesture.
    const setZoom = (
      to: (current: number) => number,
      snapped = true,
      point: { clientX: number; clientY: number } | null = null,
      tab = zoomTab(point?.clientX ?? null, point?.clientY ?? null),
    ): boolean => {
      // Not a document (the start page, Settings, a conversation): no zoom.
      if (!tab) return false;
      target = tab;
      anchorClientX = point?.clientX ?? null;
      anchorClientY = point?.clientY ?? null;
      const zoom = to(contentZoom(tab));
      zoomRef.current = snapped ? snap(zoom) : clamp(zoom);
      if (!raf) raf = requestAnimationFrame(applyFrame);
      clearTimeout(persistTimer);
      persistTimer = setTimeout(persistNow, PERSIST_DELAY_MS);
      return true;
    };

    // The restored zoom is the starting state, not a step to anchor.
    if (zoomRef.current !== 1) {
      document.documentElement.style.setProperty(
        "--content-zoom",
        String(zoomRef.current),
      );
    }

    // Trackpad pinch: scale is cumulative from the gesture's start, so the
    // zoom at gesturestart is the base it multiplies.
    let pinchBase = 1;
    let pinchTab: HTMLElement | null = null;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      const { clientX, clientY } = e as WebKitGestureEvent;
      pinchTab = zoomTab(clientX, clientY);
      pinchBase = pinchTab ? contentZoom(pinchTab) : 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const { scale } = e as WebKitGestureEvent;
      if (scale > 0 && pinchTab)
        setZoom(
          () => pinchBase * scale,
          false,
          e as WebKitGestureEvent,
          pinchTab,
        );
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      if (pinchTab)
        setZoom(() => zoomRef.current, true, e as WebKitGestureEvent, pinchTab);
      pinchTab = null;
    };

    // mod+wheel zoom. Exponential, so steps are proportional to the current
    // level. Chromium reports trackpad pinch as ctrl+wheel too. As in VS
    // Code, a gesture that began as a scroll stays one: Cmd pressed while
    // the page still moves (a trackpad's glide) doesn't turn it into a zoom.
    let lastScroll = -Infinity;
    const onWheel = (e: WheelEvent) => {
      const modified = e.metaKey || e.ctrlKey;
      if (!modified || e.timeStamp - lastScroll < SCROLL_GESTURE_MS) {
        lastScroll = e.timeStamp;
        return;
      }
      if (setZoom((z) => z * Math.exp(-e.deltaY * 0.0015), true, e))
        e.preventDefault();
    };

    window.addEventListener("gesturestart", onGestureStart);
    window.addEventListener("gesturechange", onGestureChange);
    window.addEventListener("gestureend", onGestureEnd);
    window.addEventListener("wheel", onWheel, { passive: false });

    const unlistenMenu = unlistenAll(
      listenToThisWindow("menu-zoom-in", () => setZoom((z) => z * MENU_STEP)),
      listenToThisWindow("menu-zoom-out", () => setZoom((z) => z / MENU_STEP)),
      listenToThisWindow("menu-zoom-reset", () => setZoom(() => 1)),
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
