import { useEffect, useId, useState, type ReactNode } from "react";
import { CloseIcon } from "./icons";
import { Tooltip } from "./Tooltip";
import { Presence, PresenceDiv } from "../motion/usePresence";
import "./corner-toast.css";

interface CornerToastAction {
  label: string;
  onSelect: () => void;
  primary?: boolean;
}

/**
 * The one card in a window corner that tells or offers something without
 * stopping the user: an update, a plugin suggestion, drafts brought back.
 * One line, its buttons, an optional × and, with `details`, a line that
 * opens to say more. Never takes the focus. Placed in a CornerStack.
 */
export function CornerToast({
  show,
  label,
  icon,
  line,
  details,
  actions,
  close,
  name,
}: {
  show: boolean;
  /** What the card is, for assistive technology. */
  label?: string;
  icon?: ReactNode;
  line: ReactNode;
  details?: ReactNode;
  actions: CornerToastAction[];
  /** The × button, named by what it does. */
  close?: { label: string; onSelect: () => void };
  /** Its own class, for tests and per-card tweaks. */
  name?: string;
}) {
  const [open, setOpen] = useState(false);
  const moreId = useId();
  useEffect(() => {
    if (!show) setOpen(false);
  }, [show]);
  const head = (
    <>
      {icon}
      <span className="corner-toast-line">{line}</span>
    </>
  );
  return (
    <Presence show={show}>
      {show && (
        <PresenceDiv
          className={`corner-toast floating-surface${name ? ` ${name}` : ""}`}
          role={label ? "region" : undefined}
          aria-label={label}
          data-open={open || undefined}
        >
          {details ? (
            <button
              type="button"
              className="corner-toast-summary"
              aria-expanded={open}
              aria-controls={moreId}
              onClick={() => setOpen((v) => !v)}
            >
              {head}
            </button>
          ) : (
            <span className="corner-toast-summary">{head}</span>
          )}
          <div className="corner-toast-actions">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className={
                  action.primary
                    ? "corner-toast-primary"
                    : "corner-toast-secondary"
                }
                onClick={action.onSelect}
              >
                {action.label}
              </button>
            ))}
            {close && (
              <Tooltip text={close.label}>
                <button
                  type="button"
                  className="tx-icon-button corner-toast-close"
                  aria-label={close.label}
                  onClick={close.onSelect}
                >
                  <CloseIcon />
                </button>
              </Tooltip>
            )}
          </div>
          {open && details && (
            <div className="corner-toast-more" id={moreId}>
              {details}
            </div>
          )}
        </PresenceDiv>
      )}
    </Presence>
  );
}

/** A window corner's toasts, stacked so none covers another. */
export function CornerStack({
  corner,
  children,
}: {
  corner: "start" | "end";
  children: ReactNode;
}) {
  return (
    <div className="corner-stack" data-corner={corner}>
      {children}
    </div>
  );
}
