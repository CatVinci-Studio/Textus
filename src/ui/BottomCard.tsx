import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePresenceProps } from "./usePresence";
import "./BottomCard.css";

export interface BottomCardAction {
  label: string;
  onSelect: () => void;
  primary?: boolean;
}

/** A phone's card from the bottom edge for one thing in the text (a review
 *  note, a grammar suggestion): content on top, two big action buttons below.
 *  Dims the page and closes on a tap outside or Escape. */
export function BottomCard({
  label,
  children,
  actions,
  onClose,
}: {
  /** What the card is, for assistive technology. */
  label: string;
  children: ReactNode;
  actions: BottomCardAction[];
  onClose: () => void;
}) {
  const presence = usePresenceProps<HTMLDivElement>();
  const open = presence["data-state"] === "open";
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);
  return createPortal(
    <div
      {...presence}
      className="bottom-card-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bottom-card" role="dialog" aria-label={label}>
        <div className="bottom-card-grab" aria-hidden="true" />
        <div className="bottom-card-body">{children}</div>
        <div className="bottom-card-actions">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className={a.primary ? "bottom-card-primary" : undefined}
              onClick={() => {
                a.onSelect();
                onClose();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
