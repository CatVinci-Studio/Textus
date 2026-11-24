import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isImeKeydown } from "../../utils/ime";
import { usePresenceProps } from "../motion/usePresence";
import "./sheet.css";

/**
 * A phone's sheet from the bottom edge: the dimming behind it, its spring in
 * and out, and the ways out - a tap outside or Escape (not while an input
 * method is composing). The card (BottomCard) and the table's size are its
 * bodies.
 */
export function Sheet({
  label,
  className,
  onClose,
  children,
}: {
  /** What the sheet is, for assistive technology. */
  label?: string;
  className: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const presence = usePresenceProps<HTMLDivElement>();
  const open = presence["data-state"] === "open";
  // Both in the commit that shows it: a key a moment later is already its.
  useLayoutEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isImeKeydown(e)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);
  // The click a tap makes after the finger lifts can reach a sheet that the
  // same tap opened: only a press made on it counts (a key's click too).
  const pressed = useRef(false);
  return createPortal(
    <div
      {...presence}
      className="sheet-scrim"
      onPointerDown={() => (pressed.current = true)}
      onClickCapture={(e) => {
        if (pressed.current || e.detail === 0) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        tabIndex={-1}
        className={`sheet ${className}`}
        role="dialog"
        aria-label={label}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
