import { DRAG_START_PX, TOUCH_SLOP_PX } from "../../../utils/gesture";
import { scaledPx } from "../../tokens/chrome-scale";
import { rowIslandAt } from "../../frame/frame-store";
import { trackDrag } from "../../drag/pointer-drag";
import { useEffect, useRef } from "react";
import { CloseIcon, LockIcon } from "../icons";
import { Tooltip } from "../Tooltip";
import { iosFiles } from "../../../platform/ios-files";
import { isIOSApp } from "../../../platform/capabilities";

// One tab in the bar and what a pointer or finger does with it: a click
// brings it to the front, a drag along the bar reorders, one down out of it
// is the caller's pull. A finger holds it still first to lift it.

export interface TabInfo {
  id: string;
  // Display name: filename, "Untitled", or a Help document's title.
  title: string;
  dirty: boolean;
  /** Opened to look (DocTab.preview): its title in italics. */
  preview?: boolean;
  /** The file, where it has one. */
  path?: string | null;
  /** Said on hover: what the name leaves out. */
  tip?: string;
  /** Its content's own mark (a file Textus AI changed): its name in the
   *  accent, as in the file tree. */
  marked?: boolean;
  /** In reading mode: a padlock before its name turns it off. */
  readOnly?: boolean;
  /** How many of Textus AI's revisions wait in it: a count after its name. */
  waiting?: number;
}

// How far a tab is dragged off the bar to leave it; dy always wins, like
// Chrome. A reorder starts at DRAG_START_PX.
const PULL_OUT_PX = 40;
// A finger holds a tab this long, this still, to lift it: before that, a
// move scrolls the bar.
const LIFT_MS = 300;

/** Another island's row than pane `own`'s under (x, y), as placed. */
function rowAt(x: number, y: number, own: string | null): boolean {
  const island = rowIslandAt(x, y);
  return !!island && island.paneId !== own;
}

export function TabPill({
  tab,
  pane,
  place,
  at,
  width,
  cut,
  isActive,
  labels,
  onActivate,
  onClose,
  onPullOut,
  onDrag,
  onDrop,
  onKeep,
  onMenu,
  onUnlock,
}: {
  tab: TabInfo;
  /** Its row's pane (null: a row of no island). */
  pane: string | null;
  /** Its ref in its strip, which places it (useTabStrip). */
  place: (el: HTMLElement | null) => void;
  /** Where it stands in its row: first, last, just before the open tab -
   *  what its divider and its curve at the island's corner go by. */
  at?: string;
  /** Its width in the row and whether its name is cut (tab-widths.ts);
   *  none until the row is measured: as wide as its content then. */
  width?: number;
  cut?: boolean;
  isActive: boolean;
  labels: {
    close: string;
    unsaved: string;
    readOnly?: string;
    /** What its count of waiting revisions says. */
    waiting?: (n: number) => string;
  };
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** Pulled out of its row: the drag, from `e` on, is the caller's. */
  onPullOut?: (id: string, title: string, e: PointerEvent) => void;
  /** Dragged `dx` along the row, and let go there: the strip makes room
   *  and moves it on. */
  onDrag: (id: string, dx: number) => void;
  onDrop: (id: string, dx: number) => void;
  /** A double click keeps a preview tab. */
  onKeep?: (id: string) => void;
  onMenu?: (x: number, y: number) => void;
  /** Its padlock clicked: reading mode off. */
  onUnlock?: (id: string) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    startX: number;
    startY: number;
    reordering: boolean;
    /** A finger's press, until it has held still long enough to lift. */
    waiting?: ReturnType<typeof setTimeout>;
    lifted?: boolean;
  } | null>(null);
  const title = tab.title;

  /** It follows the pointer `dx` along; 0 puts it back in its place. */
  function carry(dx: number) {
    const el = elRef.current;
    if (!el) return;
    // `translate`, not `transform`: the lifted look's scale would scale the
    // offset too, and the tab drift off the pointer.
    el.style.translate = dx ? `${dx}px 0` : "";
    el.style.zIndex = dx ? "10" : "";
  }

  // Once lifted, the finger drags the tab, not the bar: its moves are kept
  // from scrolling until it comes off the glass, the pull included. Coming
  // off, it sends no click: that would land on the menu it just opened.
  const holding = useRef(false);
  const lifted = useRef(false);
  useEffect(() => {
    const el = elRef.current;
    const hold = (e: TouchEvent) => holding.current && e.preventDefault();
    const end = (e: TouchEvent) => {
      if (lifted.current) e.preventDefault();
      lifted.current = false;
    };
    el?.addEventListener("touchmove", hold, { passive: false });
    el?.addEventListener("touchend", end, { passive: false });
    return () => {
      el?.removeEventListener("touchmove", hold);
      el?.removeEventListener("touchend", end);
      // A tab gone under the finger doesn't lift afterwards.
      clearTimeout(gesture.current?.waiting);
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

  // A mouse's drag goes by trackDrag (Esc puts the tab back); a finger's
  // waits to be lifted first, then follows the same way.
  const tracked = useRef<{ cancel: () => void } | null>(null);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const touch = e.pointerType === "touch";
    lifted.current = false;
    gesture.current = {
      startX: e.clientX,
      startY: e.clientY,
      reordering: false,
      waiting: touch ? setTimeout(lift, LIFT_MS) : undefined,
    };
    if (touch) return;
    tracked.current = trackDrag(e.nativeEvent, {
      move: (x, y, ev) => follow(x, y, ev),
      end: (x, _y, dropped) => {
        const g = gesture.current;
        gesture.current = null;
        tracked.current = null;
        carry(0);
        if (g?.reordering) onDrop(tab.id, dropped ? x - g.startX : 0);
      },
    });
  }

  /** The tab follows the pointer at (x, y): along its row, or out of it
   *  (pulled off, or across onto another island's row) as the caller's. */
  function follow(x: number, y: number, native: PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    const pulled =
      onPullOut &&
      (Math.abs(y - g.startY) > scaledPx(PULL_OUT_PX) || rowAt(x, y, pane));
    if (pulled) {
      // Neighbours slide home, and the drag is the caller's from here.
      gesture.current = null;
      carry(0);
      tracked.current?.cancel();
      onPullOut(tab.id, title, native);
      return;
    }
    const dx = x - g.startX;
    if (!g.reordering) {
      if (Math.abs(dx) < DRAG_START_PX) return;
      g.reordering = true;
    }
    carry(dx);
    onDrag(tab.id, dx);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || e.pointerType !== "touch") return;
    if (g.waiting) {
      // Moved before it lifted: a scroll of the bar, not a drag.
      if (
        Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > TOUCH_SLOP_PX
      ) {
        letGo();
        gesture.current = null;
      }
      return;
    }
    follow(e.clientX, e.clientY, e.nativeEvent);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    // A mouse's drag ends in trackDrag; a press that never moved is a click.
    if (e.pointerType !== "touch" && g?.reordering) return;
    letGo();
    gesture.current = null;
    if (!g) return;
    if (!g.reordering) {
      // Lifted and let go where it was: the tab's menu, as a long press.
      if (g.lifted && onMenu) onMenu(e.clientX, e.clientY);
      else onActivate(tab.id);
      return;
    }
    // It glides on from where it was let go to the place it passed into.
    carry(0);
    onDrop(tab.id, e.clientX - g.startX);
  }

  return (
    <div
      ref={(el) => {
        elRef.current = el;
        place(el);
      }}
      data-tab={tab.id}
      data-place={at || undefined}
      className={`tab-pill ${isActive ? "tab-pill-active" : ""}${tab.preview ? " tab-pill-looking" : ""}`}
      style={width === undefined ? undefined : { width }}
      data-marked={tab.marked || undefined}
      onDoubleClick={tab.preview && onKeep ? () => onKeep(tab.id) : undefined}
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={(e) => {
        if (e.pointerType !== "touch") return;
        const g = gesture.current;
        letGo();
        gesture.current = null;
        carry(0);
        if (g?.reordering) onDrop(tab.id, 0);
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
    >
      {tab.dirty && (
        <span
          className="tab-pill-dirty-dot"
          role="img"
          aria-label={labels.unsaved}
        />
      )}
      {tab.readOnly && (
        // With the tabs in the window bar's row the title, and its
        // padlock, give way to them: the tab carries it instead.
        <Tooltip text={labels.readOnly ?? ""} description={null}>
          <span
            className="tab-pill-lock"
            role="img"
            aria-label={labels.readOnly}
            onPointerDown={(e) => onUnlock && e.stopPropagation()}
            onClick={(e) => {
              if (!onUnlock) return;
              e.stopPropagation();
              onUnlock(tab.id);
            }}
          >
            <LockIcon />
          </span>
        </Tooltip>
      )}
      {cut || tab.tip ? (
        // A name cut short reads whole on hover.
        <Tooltip text={tab.tip ?? title} description={null}>
          <span className="tab-pill-title" data-cut={cut || undefined}>
            {title}
          </span>
        </Tooltip>
      ) : (
        <span className="tab-pill-title">{title}</span>
      )}
      {!!tab.waiting && (
        <Tooltip text={labels.waiting?.(tab.waiting) ?? ""} description={null}>
          <span
            className="tab-pill-waiting"
            role="img"
            aria-label={labels.waiting?.(tab.waiting)}
          >
            {tab.waiting}
          </span>
        </Tooltip>
      )}
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
