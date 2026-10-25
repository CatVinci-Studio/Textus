import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { listenToThisWindow, unlistenAll } from "../utils/tauri-events";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Strings } from "../i18n/strings";
import {
  floatingDragArgs,
  makeBlankTab,
  type DetachedTabDoc,
  type DocTab,
} from "../document/doc-tabs";
import { windowIpc, type WindowBounds } from "../platform/ipc";
import { flushPendingWrites } from "../storage/pending-writes";
import { useLatest } from "../utils/hooks/useLatest";
import { canUseWindows } from "../platform/capabilities";

// Everything about moving tabs BETWEEN windows lives here, both directions:
//
// - As a drag SOURCE: handleTabDetach (a pill pulled off the tab bar) and
//   the whole-window drag (a single-tab window dropped onto another window)
//   both hand the document to Rust's floating drag (tab_drag.rs) and drop
//   all claim on it.
// - As a merge TARGET: the drag-hover preview pill riding this window's tab
//   bar, and receive-detached-tab landing the document as a real tab.
//
// Within-bar reordering is NOT here - that's TabBar.tsx's own DOM drag.

// The drop target is a window's TOP STRIP - the floating window bar, plus the
// tab bar beneath it when the window has one - not the window's whole body.
// Sized to cover both with headroom: .window-bar is 28px and .tab-bar's own
// padding puts its pills at roughly 34-66px.
const TAB_ROW_HEIGHT_LOGICAL = 72;

// All drag hit-testing happens in the global LOGICAL coordinate space -
// PointerEvent.screenX/Y and the Rust drag-tick cursor are both logical
// points - so each candidate window's physical bounds are converted via its
// OWN scaleFactor (it may sit on a different-DPI display than the one the
// drag started from).
function pointInTopStrip(lx: number, ly: number, w: WindowBounds): boolean {
  const x = w.x / w.scaleFactor;
  const y = w.y / w.scaleFactor;
  const width = w.width / w.scaleFactor;
  return (
    lx >= x && lx <= x + width && ly >= y && ly <= y + TAB_ROW_HEIGHT_LOGICAL
  );
}

export interface DragHoverPreview {
  title: string;
  dirty: boolean;
  x: number;
}

export function useTabDragMerge(opts: {
  tabsRef: MutableRefObject<DocTab[]>;
  /** useTabState.ts's liveTabs - a handed-off document must carry the edit
   *  the editor's debounce still holds, or it is lost with this window's
   *  copy. */
  liveTabs: () => DocTab[];
  t: Strings;
  removeTab: (id: string) => void;
  setTabs: Dispatch<SetStateAction<DocTab[]>>;
  setActiveTabId: (id: string) => void;
}) {
  const { tabsRef, liveTabs, t, removeTab, setTabs, setActiveTabId } = opts;

  // Set while a floating tab drag is hovering THIS window's tab row as a
  // merge target - rendered as a real-looking pill riding the cursor along
  // the bar (x is already window-local logical px; see the "drag-hover"
  // listener below for the conversion).
  const [dragHoverPreview, setDragHoverPreview] =
    useState<DragHoverPreview | null>(null);
  // This window's own left edge in global logical points, cached for the
  // duration of one hover (the window can't move while something is being
  // dragged over it) - converts the drag's global cursor x to local.
  const previewWinLeftRef = useRef<number | null>(null);

  const hitTestWindow = useCallback(
    async (screenX: number, screenY: number): Promise<string | null> => {
      const selfLabel = getCurrentWindow().label;
      try {
        const bounds = await windowIpc.listWindowBounds();
        const hit = bounds.find(
          (b) => b.label !== selfLabel && pointInTopStrip(screenX, screenY, b),
        );
        return hit?.label ?? null;
      } catch {
        return null;
      }
    },
    [],
  );

  // THE FLOATING TAB: the single "a tab is in flight" state both drag
  // flows funnel into - and it lives entirely in Rust
  // (start_floating_tab_drag), not here. The moment a tab is pulled past
  // the detach threshold, it leaves this window for good: its live content
  // (possibly an unsaved draft, or edits that never hit disk) is handed
  // over, the pill disappears from the bar, and Rust carries the document
  // to wherever the mouse releases - another window's tab row (pushed
  // there as a real tab, including back onto THIS window's row, which
  // simply re-inserts it), or empty space (a fresh window right at the
  // drop point). This window keeps no claim on it: the handoff is the
  // whole point, since the drag must survive this window's own DOM (and,
  // in the whole-window flow below, this window's very existence).
  const handleTabDetach = useCallback(
    async (id: string) => {
      const tab = liveTabs().find((tb) => tb.id === id);
      if (!tab) return;
      try {
        await windowIpc.startFloatingTabDrag(floatingDragArgs(tab, t, false));
      } catch {
        return; // drag couldn't start (unsupported platform / one already active) - keep the tab
      }
      removeTab(id);
    },
    [liveTabs, removeTab, t],
  );

  // Single-tab windows have no tab bar to drag a pill out of (App.tsx's
  // showTabBar), so they're merged by dragging the whole native window (its
  // title bar) onto another Textus window instead - the same gesture
  // Safari/Chrome use to combine two single-tab windows into one.
  //
  // Tauri's onMoved fires on every tick of a drag but there is no "drag
  // ended" event, and merging on anything short of the actual button
  // release is wrong (an early debounce-based version merged while the
  // user was merely holding still, mid-drag). So the FIRST onMoved of a
  // drag asks Rust to stream window-drag-tick events - real cursor
  // position + real button state, polled natively only for the duration
  // of this one drag - and this window's only job is watching those ticks
  // for the moment the cursor enters another window's tab row. At that
  // moment the window BECOMES the floating tab: its document is handed to
  // Rust (start_floating_tab_drag) and the window itself is destroyed -
  // destroy is the one window operation macOS reliably honors mid-drag
  // (hide gets ignored by the drag session, which kept the "original"
  // window visibly in hand). From there the drag is Rust's entirely, same
  // as a tab pulled from a bar: still un-merged while the button is down,
  // carried as the preview/pill, and landed wherever release happens - back
  // in open space just means a fresh window there. Release before ever
  // touching a row: it was a plain window move, nothing happens.
  const windowDragRef = useRef<"idle" | "watching" | "handed-off">("idle");
  // Subscribed once; a tick reads these as they are then.
  const latest = useLatest({ hitTestWindow, liveTabs, t });

  useEffect(() => {
    // One window, never dragged, on iOS.
    if (!canUseWindows) return;
    const win = getCurrentWindow();

    async function handleTick(x: number, y: number, down: boolean) {
      if (!down) {
        windowDragRef.current = "idle";
        return;
      }
      if (windowDragRef.current !== "watching") return;
      const target = await latest.current.hitTestWindow(x, y);
      // Re-check the phase: a tick may have finished the handoff while
      // this hit test was in flight.
      if (!target || windowDragRef.current !== "watching") return;
      const tab = latest.current.liveTabs()[0];
      if (!tab) return;
      windowDragRef.current = "handed-off";
      // Rust destroys this window at once (destroySource), mid-drag, with
      // no time to wait for anything - but whatever storage writes it still
      // holds back are sent first, and land before the drag command does.
      void flushPendingWrites();
      void windowIpc.startFloatingTabDrag(
        floatingDragArgs(tab, latest.current.t, true),
      );
    }

    // Ticks run strictly in order - two interleaved handlers could both
    // pass the "watching" check and hand the document off twice.
    let chain: Promise<void> = Promise.resolve();
    const unlistenTick = listenToThisWindow<{
      x: number;
      y: number;
      down: boolean;
    }>("window-drag-tick", (event) => {
      const { x, y, down } = event.payload;
      chain = chain.then(() => handleTick(x, y, down)).catch(() => {});
    });

    const unlistenMoved = win.onMoved(() => {
      // Lazy trigger: nothing beyond this guard runs unless a SINGLE-tab
      // window actually starts moving (multi-tab windows merge via their
      // tab pills instead). Rust double-checks the button is really down -
      // a programmatic setPosition also fires onMoved - and refuses to
      // double-track, so a stray extra call here is harmless.
      if (windowDragRef.current !== "idle" || tabsRef.current.length !== 1)
        return;
      windowDragRef.current = "watching";
      void windowIpc.startWindowDragTracking().then((started) => {
        if (!started && windowDragRef.current === "watching")
          windowDragRef.current = "idle";
      });
    });

    return unlistenAll(unlistenTick, unlistenMoved);
  }, [latest, tabsRef]);

  // A floating tab dropped onto this window's tab row (Rust's drag thread
  // emits it on release): lands at the slot it was hovering - the
  // insertion index is however many pills sit left of the drop point -
  // not at the end of the bar. The drag deliberately doesn't send a
  // hover-off first: the preview pill is replaced by the real tab in the
  // same render, so there's no empty-gap flash in between.
  useEffect(() => {
    const unlisten = listenToThisWindow<DetachedTabDoc & { x: number }>(
      "receive-detached-tab",
      (event) => {
        const { x, ...doc } = event.payload;
        const newTab = { ...makeBlankTab(), ...doc };
        const winLeft = previewWinLeftRef.current;
        let index = tabsRef.current.length;
        if (winLeft !== null) {
          const localX = x - winLeft;
          index = tabsRef.current.filter((tab) => {
            const node = document.querySelector<HTMLElement>(
              `[data-flip-id="${CSS.escape(tab.id)}"]`,
            );
            if (!node) return false;
            const rect = node.getBoundingClientRect();
            return rect.left + rect.width / 2 < localX;
          }).length;
        }
        previewWinLeftRef.current = null;
        setDragHoverPreview(null);
        setTabs((prev) => {
          const next = [...prev];
          next.splice(index, 0, newTab);
          return next;
        });
        setActiveTabId(newTab.id);
      },
    );
    return unlistenAll(unlisten);
  }, [setActiveTabId, setTabs, tabsRef]);

  // Live "a tab is being dragged along this bar" feedback for this window
  // as a MERGE TARGET - Rust's floating drag emits it every tick with the
  // global cursor x; converted here to window-local so TabBar can slide
  // the preview pill to it. Purely a receiver.
  useEffect(() => {
    const unlisten = listenToThisWindow<DragHoverPreview | null>(
      "drag-hover",
      async (event) => {
        if (!event.payload) {
          previewWinLeftRef.current = null;
          setDragHoverPreview(null);
          return;
        }
        if (previewWinLeftRef.current === null) {
          const win = getCurrentWindow();
          const [pos, scale] = await Promise.all([
            win.outerPosition(),
            win.scaleFactor(),
          ]);
          previewWinLeftRef.current = pos.x / scale;
        }
        setDragHoverPreview({
          ...event.payload,
          x: event.payload.x - previewWinLeftRef.current,
        });
      },
    );
    return unlistenAll(unlisten);
  }, [setActiveTabId, setTabs, tabsRef]);

  return { dragHoverPreview, handleTabDetach };
}
