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

/** The hint over an icon-only button, replacing `title`, which WebKitGTK shows
 *  late or not at all. Never on touch; never takes focus or the pointer. In a
 *  portal on <body>, so no ancestor's transform or clip traps it. */
export function Tooltip({
  text,
  description = text,
  side = "below",
  children,
}: {
  text: string;
  /** What a screen reader hears instead, when the shown text repeats something
   *  the button already says (its aria-pressed state). Null for nothing. */
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

  // Esc hides it wherever the focus is, but is only taken for itself when the
  // button has focus. A scroll that moves the button hides it too.
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
        timerRef.current = window.setTimeout(
          () => setOpen(true),
          TOOLTIP_OPEN_MS,
        );
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
      // WebKit counts a focus a tap leaves as visible; a touch screen has
      // no hover to explain anything with.
      if (window.matchMedia?.("(hover: none)").matches) return;
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
  // The bubble's size is known only once in the DOM, so it is placed in a
  // layout effect, before the first paint.
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
