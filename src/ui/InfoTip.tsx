import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useCloseOnOutsideClick } from "../utils/hooks/useCloseOnOutsideClick";
import { useViewportClamp } from "../utils/hooks/useViewportClamp";
import { Presence, usePresenceProps } from "./usePresence";
import "./InfoTip.css";

/** How long the pointer may be off both the button and the card before a
 *  hover-opened card closes: long enough to cross the gap between them. */
const HOVER_CLOSE_MS = 160;
/** How long the pointer rests on the button before the card opens, so
 *  passing over it on the way to the switch beside it shows nothing. */
const HOVER_OPEN_MS = 250;

/**
 * A small "?" after a label, for the explanation a label can't carry - a
 * trade-off, what happens behind the scenes - kept off the page until it
 * is asked for, so a page of settings reads as a list of names.
 *
 * The card opens on hover with a mouse, on a click or tap (the only way on
 * a touch screen), and on keyboard focus; Esc, a click outside, a scroll
 * or moving the pointer away closes it. A click keeps it open until the next click.
 * The explanation is the button's description for a screen reader either
 * way, so it is heard without opening anything.
 *
 * The card lives in a portal on <body>, as Select's list does: an ancestor
 * with a transform or a scroll clip (Settings' content) would trap it.
 */
export function InfoTip({
  label,
  children,
}: {
  /** The button's accessible name: "More about <the row's label>". */
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Opened by a click: stays until the next click, Esc or a click outside,
  // not when the pointer wanders off.
  const pinned = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  const tipId = useId();

  const clearTimer = () => window.clearTimeout(timer.current);
  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    pinned.current = false;
    setOpen(false);
  }, []);
  useEffect(() => clearTimer, []);
  // The card is placed once, under the button: a scroll that moves the
  // button would leave it behind, so it closes instead, as a Select's list
  // does. A scroll event comes a frame late, so one that ended before the
  // card opened (the row scrolled into view) moved nothing and is let be.
  useEffect(() => {
    if (!open) return;
    const at = buttonRef.current?.getBoundingClientRect();
    const onScroll = () => {
      const now = buttonRef.current?.getBoundingClientRect();
      if (now && at && now.top === at.top && now.left === at.left) return;
      close();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open, close]);
  const wrapRef = useCloseOnOutsideClick<HTMLSpanElement>(close, true, open);

  const hoverOpen = () => {
    clearTimer();
    if (!open)
      timer.current = window.setTimeout(() => setOpen(true), HOVER_OPEN_MS);
  };
  const hoverClose = () => {
    clearTimer();
    if (!pinned.current)
      timer.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
  };

  return (
    <span ref={wrapRef} className="info-tip">
      <button
        ref={buttonRef}
        type="button"
        className="info-tip-button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={descriptionId}
        aria-controls={open ? tipId : undefined}
        onClick={(e) => {
          // Inside a row's <label>, a click must not reach the switch.
          e.preventDefault();
          e.stopPropagation();
          clearTimer();
          if (open && pinned.current) close();
          else {
            pinned.current = true;
            setOpen(true);
          }
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") hoverOpen();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") hoverClose();
        }}
        // Tabbing to it shows the card, as hovering does; a click's focus
        // is the click's business.
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible")) {
            clearTimer();
            setOpen(true);
          }
        }}
        onBlur={() => {
          if (!pinned.current) close();
        }}
        // One Escape closes the card, not also the dialog it sits in
        // (useModalDialog skips a handled Escape).
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.preventDefault();
            close();
          }
        }}
      >
        ?
      </button>
      <span id={descriptionId} className="info-tip-description" hidden>
        {children}
      </span>
      <Presence show={open} exitMs={120}>
        {open && (
          <InfoTipCard
            id={tipId}
            anchor={buttonRef}
            onPointerEnter={clearTimer}
            onPointerLeave={hoverClose}
          >
            {children}
          </InfoTipCard>
        )}
      </Presence>
    </span>
  );
}

function InfoTipCard({
  id,
  anchor,
  children,
  onPointerEnter,
  onPointerLeave,
}: {
  id: string;
  anchor: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const box = anchor.current?.getBoundingClientRect();
    if (box) setAt({ x: box.left, y: box.bottom + 6 });
  }, [anchor]);
  const pos = useViewportClamp(ref, at.x, at.y);
  const presence = usePresenceProps(ref);
  const origin = {
    "--transform-origin": `${Math.max(0, at.x - pos.left)}px 0`,
  } as CSSProperties;
  return createPortal(
    <div
      {...presence}
      id={id}
      role="tooltip"
      className="info-tip-card floating-surface"
      style={{ ...pos, ...origin }}
      data-floating-tip=""
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") onPointerEnter();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") onPointerLeave();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
