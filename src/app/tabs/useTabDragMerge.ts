import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { listenToThisWindow, unlistenAll } from "../../platform/events";
import { thisWindow } from "../../platform/this-window";
import type { Strings } from "../../i18n/strings";
import {
  floatingDragArgs,
  makeBlankTab,
  type DetachedTabDoc,
  type DocTab,
} from "../../document/doc-tabs";
import { windowIpc, type WindowBounds } from "../../platform/ipc";
import { flushPendingWrites } from "../../storage/pending-writes";
import { useLatest } from "../../utils/hooks/useLatest";
import { canUseWindows } from "../../platform/capabilities";

// Moving tabs between windows, as drag source (handed to Rust's floating
// drag) and as merge target. Within-bar reordering lives in the tab bar.

// The drop target is a window's top strip (window bar plus tab bar), with
// headroom, not its whole body.
const TAB_ROW_HEIGHT_LOGICAL = 72;

// Hit-testing is in global logical points, so each window's bounds use its
// own scaleFactor: it may sit on a different-DPI display.
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
  /** A handed-off document must carry the edit the editor's debounce still
   *  holds. */
  liveTabs: () => DocTab[];
  t: Strings;
  removeTab: (id: string) => void;
  setTabs: Dispatch<SetStateAction<DocTab[]>>;
  setActiveTabId: (id: string) => void;
}) {
  const { tabsRef, liveTabs, t, removeTab, setTabs, setActiveTabId } = opts;

  // A floating tab hovering this window's tab row; x is window-local.
  const [dragHoverPreview, setDragHoverPreview] =
    useState<DragHoverPreview | null>(null);
  // This window's left edge in global logical points, cached for one hover:
  // the window can't move while something is dragged over it.
  const previewWinLeftRef = useRef<number | null>(null);

  const hitTestWindow = useCallback(
    async (screenX: number, screenY: number): Promise<string | null> => {
      const selfLabel = thisWindow().label;
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

  // A pulled-out tab leaves this window for good: Rust carries its live
  // content to wherever the mouse releases, so the drag outlives this DOM.
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

  // A single-tab window merges by dragging the whole window onto another's
  // tab row. Tauri has no "drag ended" event, so Rust streams cursor and
  // button ticks; on entering a row the window hands off its document and is
  // destroyed, the one operation macOS honors mid-drag.
  const windowDragRef = useRef<"idle" | "watching" | "handed-off">("idle");
  const latest = useLatest({ hitTestWindow, liveTabs, t });

  useEffect(() => {
    // One window, never dragged, on iOS.
    if (!canUseWindows) return;
    const win = thisWindow();

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
      // Rust destroys this window at once; held-back storage writes are sent
      // first and land before the drag command.
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
      // Rust checks the button is really down (setPosition fires onMoved too)
      // and refuses to double-track, so a stray call is harmless.
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

  // A dropped tab lands at the slot it was hovering. No hover-off comes
  // first: the preview pill turns into the real tab in one render.
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

  // Rust sends the global cursor x every tick; made window-local here.
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
          const win = thisWindow();
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
