import { useEffect, useRef } from "react";
import { CloseIcon } from "../../ui/icons";
import { measure, play } from "../../ui/flip";
import { Tooltip } from "../../ui/Tooltip";
import { iosFiles } from "../../platform/ios-files";
import { isIOSApp } from "../../platform/capabilities";

// One tab in the bar and what a pointer or finger does with it: a click
// brings it to the front, a drag along the bar reorders, one down out of it
// is the caller's pull. A finger holds it still first to lift it.

export interface TabInfo {
  id: string;
  // Display name: filename, "Untitled", or a Help document's title.
  title: string;
  dirty: boolean;
}

// Drag distances to leave the bar (vertical) or start a reorder
// (horizontal). dy always wins, like Chrome.
const PULL_OUT_PX = 40;
const REORDER_THRESHOLD_PX = 5;
// A finger holds a tab this long, this still, to lift it: before that, a
// move scrolls the bar.
const LIFT_MS = 300;
const LIFT_SLOP_PX = 8;

// One slide for every pill making way, so overlapping moves read as one.
export const SLIDE =
  "transform calc(var(--dur-base) * var(--motion-travel)) var(--ease-in-out)";

/** Another tab bar than `own` under (x, y). */
function barAt(x: number, y: number, own: Element | null): Element | null {
  for (const bar of document.querySelectorAll(".tab-bar")) {
    if (bar === own) continue;
    const box = bar.getBoundingClientRect();
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)
      return bar;
  }
  return null;
}

interface PillRect {
  id: string;
  center: number;
  width: number;
}

export function TabPill({
  tab,
  tabIds,
  isActive,
  labels,
  onActivate,
  onClose,
  onPullOut,
  onReorder,
  captureFlip,
  onMenu,
}: {
  tab: TabInfo;
  tabIds: string[];
  isActive: boolean;
  labels: { close: string; unsaved: string };
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onPullOut?: (id: string, title: string) => void;
  onReorder: (id: string, index: number) => void;
  captureFlip: (how: { dropped?: string; gone?: string }) => void;
  onMenu?: (x: number, y: number) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    startX: number;
    startY: number;
    reordering: boolean;
    /** A finger's press, until it has held still long enough to lift. */
    waiting?: ReturnType<typeof setTimeout>;
    lifted?: boolean;
    // Resting geometry, measured once; live shifting compares against it.
    rects: PillRect[];
    gap: number;
  } | null>(null);
  const title = tab.title;

  const pillNode = (id: string): HTMLElement | null =>
    elRef.current?.parentElement?.querySelector<HTMLElement>(
      `[data-flip-id="${CSS.escape(id)}"]`,
    ) ?? null;

  function clearInlineStyles() {
    for (const id of tabIds) {
      const node = pillNode(id);
      if (!node) continue;
      node.style.transition = "";
      node.style.transform = "";
      node.style.zIndex = "";
    }
  }

  // Once lifted, the finger drags the tab, not the bar: its moves are kept
  // from scrolling until it comes off the glass, the pull included. Coming
  // off, it sends no click: that would land on the menu it just opened.
  const holding = useRef(false);
  const lifted = useRef(false);
  useEffect(() => {
    const el = elRef.current;
    const hold = (e: TouchEvent) => holding.current && e.preventDefault();
    const end = (e: TouchEvent) => lifted.current && e.preventDefault();
    el?.addEventListener("touchmove", hold, { passive: false });
    el?.addEventListener("touchend", end, { passive: false });
    return () => {
      el?.removeEventListener("touchmove", hold);
      el?.removeEventListener("touchend", end);
    };
  }, []);

  function lift() {
    const g = gesture.current;
    if (!g) return;
    g.waiting = undefined;
    g.lifted = true;
    holding.current = true;
    lifted.current = true;
    elRef.current?.classList.add("tab-pill-lifted");
    if (isIOSApp) iosFiles.haptic();
  }

  function letGo() {
    const g = gesture.current;
    if (g?.waiting) clearTimeout(g.waiting);
    holding.current = false;
    elRef.current?.classList.remove("tab-pill-lifted");
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const touch = e.pointerType === "touch";
    lifted.current = false;
    gesture.current = {
      startX: e.clientX,
      startY: e.clientY,
      reordering: false,
      rects: [],
      gap: 0,
      waiting: touch ? setTimeout(lift, LIFT_MS) : undefined,
    };
    if (!touch) e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g) return;
    if (g.waiting) {
      // Moved before it lifted: a scroll of the bar, not a drag.
      if (
        Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > LIFT_SLOP_PX
      ) {
        letGo();
        gesture.current = null;
      }
      return;
    }

    if (onPullOut && Math.abs(e.clientY - g.startY) > PULL_OUT_PX) {
      // Pulled out of the bar: neighbours slide home, and the drag is the
      // caller's from here.
      gesture.current = null;
      clearInlineStyles();
      onPullOut(tab.id, title);
      return;
    }

    // Across onto another pane's bar: it goes on as a pull, let go there.
    if (
      onPullOut &&
      barAt(e.clientX, e.clientY, elRef.current?.parentElement ?? null)
    ) {
      gesture.current = null;
      clearInlineStyles();
      onPullOut(tab.id, title);
      return;
    }

    const dx = e.clientX - g.startX;
    if (!g.reordering) {
      if (Math.abs(dx) < REORDER_THRESHOLD_PX) return;
      g.reordering = true;
      g.rects = tabIds
        .map((id) => {
          const node = pillNode(id);
          if (!node) return null;
          // Layout values, immune to transforms in flight.
          return {
            id,
            center: node.offsetLeft + node.offsetWidth / 2,
            width: node.offsetWidth,
          };
        })
        .filter((r): r is PillRect => r !== null);
      const bar = elRef.current?.parentElement;
      g.gap = bar ? parseFloat(getComputedStyle(bar).columnGap) || 0 : 0;
    }

    const el = elRef.current;
    const mine = g.rects.find((r) => r.id === tab.id);
    if (!el || !mine) return;
    el.style.transition = "none";
    el.style.transform = `translateX(${dx}px)`;
    el.style.zIndex = "10";

    const center = mine.center + dx;
    const slot = mine.width + g.gap;
    for (const r of g.rects) {
      if (r.id === tab.id) continue;
      const node = pillNode(r.id);
      if (!node) continue;
      let shift = 0;
      if (r.center < mine.center && center < r.center) shift = slot;
      else if (r.center > mine.center && center > r.center) shift = -slot;
      node.style.transition = SLIDE;
      node.style.transform = shift ? `translateX(${shift}px)` : "";
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    letGo();
    gesture.current = null;
    if (!g) return;
    if (!g.reordering) {
      // Lifted and let go where it was: the tab's menu, as a long press.
      if (g.lifted && onMenu) {
        const box = e.currentTarget.getBoundingClientRect();
        onMenu(box.left, box.bottom);
      } else onActivate(tab.id);
      return;
    }
    // The drop index is how many OTHER pills the center passed. FLIP comes
    // from the visual positions, so every pill glides to its final slot.
    const mine = g.rects.find((r) => r.id === tab.id);
    const center = (mine?.center ?? 0) + (e.clientX - g.startX);
    const index = g.rects.filter(
      (r) => r.id !== tab.id && r.center < center,
    ).length;
    if (index === tabIds.indexOf(tab.id)) {
      // Back in its own slot: no commit follows to play the slides.
      const bar = elRef.current?.parentElement;
      const rects = measure(bar?.querySelectorAll("[data-flip-id]") ?? []);
      clearInlineStyles();
      play(rects, {
        timingFor: (el) =>
          el === elRef.current
            ? { duration: "--dur-medium", easing: "--ease-spring-bouncy" }
            : undefined,
      });
    } else {
      captureFlip({ dropped: tab.id });
      clearInlineStyles();
    }
    onReorder(tab.id, index);
  }

  return (
    <div
      ref={elRef}
      data-flip-id={tab.id}
      className={`tab-pill ${isActive ? "tab-pill-active" : ""}`}
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        letGo();
        gesture.current = null;
        clearInlineStyles();
      }}
      onContextMenu={
        onMenu &&
        ((e) => {
          e.preventDefault();
          onMenu(e.clientX, e.clientY);
        })
      }
      // Otherwise WebKit starts a text selection and paints a sweep through
      // the editor once the pill detaches. (And a middle press would scroll.)
      onMouseDown={(e) => e.preventDefault()}
      // A middle click closes the tab, as in a browser.
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        onClose(tab.id);
      }}
      // Entered once: a moved node restarts its stylesheet animation.
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.dataset.entered = "";
      }}
    >
      {tab.dirty && (
        <span
          className="tab-pill-dirty-dot"
          role="img"
          aria-label={labels.unsaved}
        />
      )}
      <span className="tab-pill-title">{title}</span>
      {/* Not a button: a tab holds no control of its own. */}
      <Tooltip text={labels.close} description={null}>
        <span
          className="tab-pill-close"
          aria-hidden="true"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
        >
          <CloseIcon />
        </span>
      </Tooltip>
    </div>
  );
}
