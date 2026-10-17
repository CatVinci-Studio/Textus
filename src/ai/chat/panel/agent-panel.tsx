import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { getUiState, setUiState } from "../../../storage/ui-state";
import { animate, duration } from "../../../ui/motion";
import type { AgentPanelTab } from "./AgentPanelView";
import "./agent-panel.css";
import "../inline-chat.css";

/**
 * The docked Agent panel on the right of the editor window - the full
 * conversation's default home (the detached window remains, one click away,
 * for a second monitor).
 *
 * App owns only the frame: whether it's open, how wide, and the DOM element
 * to render into. The conversation itself stays where it already lives, in
 * each tab's editor (MilkdownEditor), which portals its own chat into the
 * frame while it is the active tab. So switching tabs switches the
 * conversation with the document, and the panel talks to its editor
 * directly - none of the detached window's context pushing between webviews,
 * which is where most of that surface's bugs came from.
 */
export interface AgentPanelFrame {
  setOpen: (open: boolean) => void;
  /** The element the active editor portals into; null while closed. */
  container: HTMLElement | null;
  /** Which of the panel's tabs shows. The frame's, not each editor's:
   *  every document tab draws its own panel, and one kept per editor put
   *  the panel back on Conversation whenever another document came to
   *  the front - opening a new library entry from Memory did exactly that,
   *  hiding the entry just made. */
  tab: AgentPanelTab;
  setTab: (tab: AgentPanelTab) => void;
}

const AgentPanelContext = createContext<AgentPanelFrame>({
  setOpen: () => {},
  container: null,
  tab: "chat",
  setTab: () => {},
});

export function useAgentPanel(): AgentPanelFrame {
  return useContext(AgentPanelContext);
}

export const AGENT_PANEL_MIN_WIDTH = 300;
export const AGENT_PANEL_MAX_WIDTH = 720;
export const AGENT_PANEL_DEFAULT_WIDTH = 380;

function clampWidth(width: number): number {
  return Math.min(
    AGENT_PANEL_MAX_WIDTH,
    Math.max(AGENT_PANEL_MIN_WIDTH, width),
  );
}

/** The panel's open state and width, remembered across launches. */
export function useAgentPanelState() {
  const [open, setOpenState] = useState(
    () => getUiState("agentPanelOpen") === true,
  );
  const [width, setWidthState] = useState(() => {
    const stored = getUiState("agentPanelWidth");
    return typeof stored === "number" && Number.isFinite(stored) && stored > 0
      ? clampWidth(stored)
      : AGENT_PANEL_DEFAULT_WIDTH;
  });
  const [tab, setTab] = useState<AgentPanelTab>("chat");
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    setUiState("agentPanelOpen", next);
    // Whatever opens the panel - the shortcut, Ask AI, a restored chat,
    // "ask about this note" - wants the conversation.
    if (next) setTab("chat");
  }, []);
  // Remembered once a drag lets go (ResizeHandle's `done`), not on every
  // frame of it.
  const setWidth = useCallback((next: number, persist = true) => {
    const clamped = clampWidth(next);
    setWidthState(clamped);
    if (persist) setUiState("agentPanelWidth", Math.round(clamped));
  }, []);
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  return { open, setOpen, toggle, width, setWidth, tab, setTab };
}

export function AgentPanelProvider({
  open,
  setOpen,
  container,
  tab,
  setTab,
  children,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  container: HTMLElement | null;
  tab: AgentPanelTab;
  setTab: (tab: AgentPanelTab) => void;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ setOpen, container: open ? container : null, tab, setTab }),
    [open, setOpen, container, tab, setTab],
  );
  return (
    <AgentPanelContext.Provider value={value}>
      {children}
    </AgentPanelContext.Provider>
  );
}

/** Movement under this many px is a tap on the handle, not a drag. */
const SHEET_TAP_SLOP = 10;

/** A release faster than this (px per ms) is a flick. */
const FLICK = 0.5;

/** Where a sheet let go at `height` (of a `full`-tall maximum) comes to
 *  rest: a flick decides by its direction, a slow drag by the nearest stop -
 *  below a third of the screen the sheet closes. */
export function sheetRestingPlace(
  height: number,
  full: number,
  velocity: number,
): "full" | "half" | "closed" {
  if (velocity < -FLICK) return "full";
  if (velocity > FLICK) return height > full * 0.7 ? "half" : "closed";
  if (height > full * 0.75) return "full";
  if (height < full * 0.33) return "closed";
  return "half";
}

type SheetPlace = ReturnType<typeof sheetRestingPlace>;

/** The half stop's share of the screen - ai-sheet.css's height for it. */
const SHEET_HALF = 0.55;

/** The geometry of one gesture, read when it starts: nothing is measured
 *  per move. Offsets are how far the sheet's top sits below the full stop. */
interface SheetCarry {
  sheet: HTMLElement;
  /** The full stop's height: the screen below the title row. */
  max: number;
  /** The half stop's offset. */
  half: number;
}

function carryOf(sheet: HTMLElement): SheetCarry {
  const max = maxSheetHeight(sheet);
  return {
    sheet,
    max,
    half: Math.max(0, max - window.innerHeight * SHEET_HALF),
  };
}

function offsetOf(carry: SheetCarry, place: SheetPlace): number {
  return place === "full" ? 0 : place === "half" ? carry.half : carry.max;
}

/** How far the composer and its bars are lifted at `offset`: all of it down
 *  to the half stop, so they stay on the screen's edge; below that they go
 *  down with the sheet, as it leaves. */
function liftAt(carry: SheetCarry, offset: number): number {
  return -Math.min(Math.max(offset, 0), carry.half);
}

/** The bottom-pinned parts of the sheet: everything under the messages. */
function pinnedParts(sheet: HTMLElement): HTMLElement[] {
  return Array.from(
    sheet.querySelectorAll<HTMLElement>(
      ".agent-panel-body > :not(.agent-panel-empty, .inline-chat-messages)",
    ),
  );
}

/** Lays the sheet out at full height and shows it at `offset` - its
 *  transform alone moves from here on (ai-sheet.css, data-carried). */
function carrySheet(carry: SheetCarry, offset: number) {
  const { sheet } = carry;
  sheet.dataset.carried = "";
  sheet.style.height = `${carry.max}px`;
  sheet.style.transform = `translateY(${offset}px)`;
  sheet.style.setProperty("--sheet-lift", `${liftAt(carry, offset)}px`);
}

/** Back to the stop its class lays it out at. Marked settled first: with
 *  data-carried gone the entrance animation was the sheet's animation again
 *  - a new one, which replayed the slide up from the bottom (a flash, under
 *  reduced motion) after every drag (ai-sheet.css). */
function setSheetDown(sheet: HTMLElement) {
  sheet.dataset.settled = "";
  delete sheet.dataset.carried;
  sheet.style.removeProperty("height");
  sheet.style.removeProperty("transform");
  sheet.style.removeProperty("--sheet-lift");
}

/** Past the top stop the sheet gives less the further it is pulled. */
function rubberBand(excess: number): number {
  return (excess * 0.55) / (1 + excess / 300);
}

/**
 * The handle on top of the panel when it is a bottom sheet (phone widths,
 * mobile/styles). The sheet follows the finger while it is dragged and
 * settles at full height, half, or closed (sheetRestingPlace); a tap toggles
 * half and full.
 *
 * All of that moves the sheet by its transform - a height that changed on
 * every frame reflowed the whole conversation under the finger. While
 * carried it is laid out at full height and moved down to where it shows;
 * the composer is lifted by as much, so it stays on the bottom edge rather
 * than sliding under it. Only once a settle has landed does the sheet go
 * back to the height its stop lays it out at, in the same frame.
 *
 * The press is default-prevented so the handle never takes focus: focus
 * moving off the composer dropped the keyboard, and the web view shrinking
 * under the finger (KeyboardFit.swift) cancelled the drag.
 */
export function AgentPanelSheetGrip({
  full,
  onFullChange,
  onClose,
  label,
}: {
  full: boolean;
  onFullChange: (full: boolean) => void;
  onClose: () => void;
  label: string;
}) {
  const drag = useRef<{
    carry: SheetCarry;
    startY: number;
    startOffset: number;
    offset: number;
    lastY: number;
    lastT: number;
    velocity: number;
    moved: boolean;
  } | null>(null);
  // A settle in flight: a new touch catches the sheet where it is.
  const settling = useRef<{
    carry: SheetCarry;
    to: SheetPlace;
    animations: Animation[];
  } | null>(null);

  /** Where a tap sends it: the other stop from the one it is going to. */
  const toggled = (): SheetPlace =>
    (settling.current ? settling.current.to === "full" : full)
      ? "half"
      : "full";

  function stopSettling() {
    const running = settling.current;
    settling.current = null;
    for (const animation of running?.animations ?? []) animation.cancel();
  }

  /** Moves the sheet from `from` to the stop `to` and lands it there. A
   *  flick lands with a little overshoot; closing goes down without it. */
  function settle(
    carry: SheetCarry,
    from: number,
    to: SheetPlace,
    velocity: number,
  ) {
    const target = offsetOf(carry, to);
    const land = () => {
      settling.current = null;
      // Already off the screen: no second way down (ai-sheet.css).
      if (to === "closed") carry.sheet.dataset.dismissed = "";
      flushSync(() => {
        if (to === "closed") onClose();
        else onFullChange(to === "full");
      });
      setSheetDown(carry.sheet);
      for (const animation of animations) animation.cancel();
    };
    carrySheet(carry, target);
    const timing =
      to === "closed"
        ? {
            // An exit's 70% of the way in (motion.css, --dur-sheet-exit).
            duration: duration("--dur-sheet") * 0.7,
            easing: "--ease-in" as const,
          }
        : {
            duration: "--dur-sheet" as const,
            easing:
              Math.abs(velocity) > FLICK
                ? ("--ease-spring-bouncy" as const)
                : ("--ease-spring" as const),
          };
    const animations = [
      animate(
        carry.sheet,
        [
          { transform: `translateY(${from}px)` },
          { transform: `translateY(${target}px)` },
        ],
        timing,
      ),
      ...pinnedParts(carry.sheet).map((part) =>
        animate(
          part,
          [
            { transform: `translateY(${liftAt(carry, from)}px)` },
            { transform: `translateY(${liftAt(carry, target)}px)` },
          ],
          timing,
        ),
      ),
    ].filter((animation): animation is Animation => animation !== null);
    if (animations.length === 0) {
      land();
      return;
    }
    settling.current = { carry, to, animations };
    // A cancel means a new touch took the sheet over; it lands it itself.
    animations[0].finished.then(land, () => {});
  }

  return (
    <div
      className="agent-panel-grip"
      role="button"
      aria-label={label}
      aria-expanded={full}
      tabIndex={0}
      onPointerDown={(e) => {
        const sheet = e.currentTarget.parentElement;
        if (!sheet) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const caught = settling.current;
        const carry = caught?.carry ?? carryOf(sheet);
        // Mid-settle, it is held wherever it has got to.
        const startOffset = caught
          ? sheet.getBoundingClientRect().top - (window.innerHeight - carry.max)
          : offsetOf(carry, full ? "full" : "half");
        stopSettling();
        if (caught) carrySheet(carry, startOffset);
        drag.current = {
          carry,
          startY: e.clientY,
          startOffset,
          offset: startOffset,
          lastY: e.clientY,
          lastT: e.timeStamp,
          velocity: 0,
          moved: false,
        };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dy = e.clientY - d.startY;
        if (!d.moved && Math.abs(dy) < SHEET_TAP_SLOP) return;
        d.moved = true;
        const dt = e.timeStamp - d.lastT;
        if (dt > 0) d.velocity = (e.clientY - d.lastY) / dt;
        d.lastY = e.clientY;
        d.lastT = e.timeStamp;
        const offset = d.startOffset + dy;
        d.offset = Math.min(
          d.carry.max,
          offset < 0 ? -rubberBand(-offset) : offset,
        );
        carrySheet(d.carry, d.offset);
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        if (!d.moved) {
          settle(d.carry, d.startOffset, toggled(), 0);
          return;
        }
        let place = sheetRestingPlace(
          d.carry.max - Math.max(0, d.offset),
          d.carry.max,
          d.velocity,
        );
        // A fast fling down from full height goes one stop, to half - it
        // closed the sheet when the fling had carried it below 70%.
        if (
          place === "closed" &&
          d.velocity > FLICK &&
          d.startOffset < d.carry.half / 2
        )
          place = "half";
        settle(d.carry, d.offset, place, d.velocity);
      }}
      onPointerCancel={() => {
        const d = drag.current;
        drag.current = null;
        if (d) settle(d.carry, d.offset, full ? "full" : "half", 0);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          const sheet = e.currentTarget.parentElement;
          if (!sheet || settling.current) return;
          const carry = carryOf(sheet);
          settle(carry, offsetOf(carry, full ? "full" : "half"), toggled(), 0);
        }
      }}
    >
      <span />
    </div>
  );
}

/** The sheet's full height: the screen below the title row. */
function maxSheetHeight(sheet: HTMLElement): number {
  const bar = parseFloat(
    getComputedStyle(sheet).getPropertyValue("--mobile-bar") || "44",
  );
  return window.innerHeight - (Number.isFinite(bar) ? bar : 44);
}
