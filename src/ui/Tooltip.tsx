import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useViewportClamp } from "../utils/hooks/useViewportClamp";
import { Presence, usePresenceProps } from "./usePresence";
import "./Tooltip.css";
import { useTipTimer } from "./useTipTimer";

/** How long the mouse rests on a button before its tooltip shows, so
 *  crossing a toolbar on the way somewhere else shows nothing. */
export const TOOLTIP_OPEN_MS = 400;
/** After one tooltip hides, moving straight to the next button shows its
 *  tooltip at once: the user is reading the toolbar, not passing it. */
const WARM_MS = 500;
/** The gap between the button and its tooltip. */
const GAP = 6;

let lastHiddenAt = -Infinity;
const markHidden = () => (lastHiddenAt = performance.now());
const warm = () => performance.now() - lastHiddenAt < WARM_MS;

/** The props Tooltip reads from or adds to its trigger. */
interface TriggerProps {
  "aria-label"?: string;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-describedby"?: string;
  onPointerEnter?: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: PointerEvent<HTMLElement>) => void;
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
}

/**
 * The hint over an icon-only button: what the native `title` was for,
 * which WebKitGTK shows late or not at all and every platform draws in
 * its own foreign box.
 *
 * `<Tooltip text="…"><button aria-label="…">…</button></Tooltip>` - the
 * one child is the trigger. The tooltip shows after the mouse has rested
 * on it (TOOLTIP_OPEN_MS) or when the keyboard moves focus onto it, and
 * goes on leave, blur, a press, Esc or a scroll that moves the button.
 * Never on touch: a finger has no hover, and a tap must just press.
 *
 * It never takes focus or the pointer (it is `pointer-events: none`), so
 * a button that keeps the focus in a text field on mousedown (the
 * composer's) keeps doing so. For a screen reader the text is the
 * button's description - unless it only repeats the button's name, which
 * would then be read twice.
 *
 * The tooltip lives in a portal on <body>, as InfoTip's card does: an
 * ancestor with a transform or a scroll clip would trap it.
 */
export function Tooltip({
  text,
  description = text,
  side = "below",
  children,
}: {
  text: string;
  /** What a screen reader hears instead, when the shown text carries
   *  something the button already says - its on/off state, which
   *  aria-pressed announces. Null for nothing. */
  description?: string | null;
  /** Where it prefers to sit; it moves to the other side when there is
   *  no room. "above" for buttons along the bottom (the composer). */
  side?: "above" | "below";
  children: ReactElement<TriggerProps>;
}) {
  const [open, setOpenState] = useState(false);
  const shown = useRef(false);
  const setOpen = useCallback((next: boolean) => {
    if (shown.current && !next) markHidden();
    shown.current = next;
    setOpenState(next);
  }, []);
  const timerRef = useTipTimer();
  const anchor = useRef<HTMLElement | null>(null);
  const id = useId();
  const descriptionId = `${id}description`;
  const tipId = `${id}tip`;
  const props = children.props;

  const close = useCallback(() => {
    window.clearTimeout(timerRef.current);
    setOpen(false);
  }, [setOpen, timerRef]);

  // Esc hides it wherever the focus is: a hover tooltip over the composer
  // while the caret stays in the field. The Escape is only taken for
  // itself when the button has the focus - otherwise it still closes
  // what it was pressed for. A scroll that moves the button leaves the
  // tooltip pointing at nothing, so it goes too.
  useEffect(() => {
    if (!open) return;
    const at = anchor.current?.getBoundingClientRect();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.activeElement === anchor.current) e.preventDefault();
      close();
    };
    const onScroll = () => {
      const now = anchor.current?.getBoundingClientRect();
      if (now && at && now.top === at.top && now.left === at.left) return;
      close();
    };
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, close]);

  const hidden =
    props["aria-hidden"] === true || props["aria-hidden"] === "true";
  const describes =
    !hidden && !!description && description !== props["aria-label"];
  const describedBy =
    [props["aria-describedby"], describes && descriptionId]
      .filter(Boolean)
      .join(" ") || undefined;

  const trigger = cloneElement(children, {
    "aria-describedby": describedBy,
    onPointerEnter: (e) => {
      props.onPointerEnter?.(e);
      if (e.pointerType !== "mouse") return;
      anchor.current = e.currentTarget;
      window.clearTimeout(timerRef.current);
      if (warm()) setOpen(true);
      else
        timerRef.current = window.setTimeout(() => setOpen(true), TOOLTIP_OPEN_MS);
    },
    onPointerLeave: (e) => {
      props.onPointerLeave?.(e);
      close();
    },
    // A press is the answer to the hint; the menu or state it brings
    // must not sit under it. It comes back only on the next visit.
    onPointerDown: (e) => {
      props.onPointerDown?.(e);
      window.clearTimeout(timerRef.current);
      setOpen(false);
    },
    onFocus: (e) => {
      props.onFocus?.(e);
      if (!e.currentTarget.matches(":focus-visible")) return;
      anchor.current = e.currentTarget;
      window.clearTimeout(timerRef.current);
      setOpen(true);
    },
    onBlur: (e) => {
      props.onBlur?.(e);
      close();
    },
  });

  return (
    <>
      {trigger}
      {describes &&
        createPortal(
          <span id={descriptionId} hidden>
            {description}
          </span>,
          document.body,
        )}
      <Presence show={open} exitMs={120}>
        {open && (
          <TooltipBubble id={tipId} anchor={anchor} side={side}>
            {text}
          </TooltipBubble>
        )}
      </Presence>
    </>
  );
}

function TooltipBubble({
  id,
  anchor,
  side,
  children,
}: {
  id: string;
  anchor: RefObject<HTMLElement | null>;
  side: "above" | "below";
  children: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ x: 0, y: 0 });
  // Centred on the button, on the preferred side if it fits there. The
  // bubble's own size is known only once it is in the DOM, so it is
  // placed in a layout effect, before the first paint.
  useLayoutEffect(() => {
    const box = anchor.current?.getBoundingClientRect();
    const el = ref.current;
    if (!box || !el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const aboveY = box.top - GAP - height;
    const belowY = box.bottom + GAP;
    const fitsAbove = aboveY >= 8;
    const fitsBelow = belowY + height <= window.innerHeight - 8;
    const above =
      side === "above" ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;
    setAt({
      x: box.left + box.width / 2 - width / 2,
      y: above ? aboveY : belowY,
    });
  }, [anchor, side, children]);
  const pos = useViewportClamp(ref, at.x, at.y);
  const presence = usePresenceProps(ref);
  return createPortal(
    <div
      {...presence}
      id={id}
      role="tooltip"
      className="tooltip floating-surface"
      style={pos}
    >
      {children}
    </div>,
    document.body,
  );
}
