import { scaledPx } from "../engine/tokens/chrome-scale";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useCloseOnOutsideClick } from "../utils/hooks/useCloseOnOutsideClick";
import { Bubble } from "./Bubble";
import { Presence } from "../engine/motion/usePresence";
import "./InfoTip.css";
import { useTipTimer } from "./useTipTimer";

/** Between the "?" and the card's tail. */
const GAP = 8;
/** How long the pointer may be off both the button and the card before a
 *  hover-opened card closes: long enough to cross the gap between them. */
const HOVER_CLOSE_MS = 160;
/** How long the pointer rests on the button before the card opens, so
 *  passing over it on the way to the switch beside it shows nothing. */
const HOVER_OPEN_MS = 250;

/** A small "?" after a label, for what the label can't carry; a click pins
 *  it open. It lives in a portal on <body>, since an ancestor's transform or
 *  scroll clip would trap it. */
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
  const timerRef = useTipTimer();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const descriptionId = `${id}description`;
  const tipId = `${id}tip`;

  const clearTimer = () => window.clearTimeout(timerRef.current);
  const close = useCallback(() => {
    window.clearTimeout(timerRef.current);
    pinned.current = false;
    setOpen(false);
  }, [timerRef]);
  // Placed once under the button, so a scroll closes it. A scroll event comes
  // a frame late, so one that ended before the card opened is let be.
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
      timerRef.current = window.setTimeout(() => setOpen(true), HOVER_OPEN_MS);
  };
  const hoverClose = () => {
    clearTimer();
    if (!pinned.current)
      timerRef.current = window.setTimeout(
        () => setOpen(false),
        HOVER_CLOSE_MS,
      );
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
        // One Escape closes the card, not also the dialog it sits in.
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
  return (
    <Bubble
      id={id}
      role="tooltip"
      className="info-tip-card floating-surface"
      anchor={anchor}
      align="start"
      gap={scaledPx(GAP)}
      data-floating-tip=""
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") onPointerEnter();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") onPointerLeave();
      }}
    >
      {children}
    </Bubble>
  );
}
