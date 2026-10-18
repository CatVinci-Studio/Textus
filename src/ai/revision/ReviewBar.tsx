import { useId, useRef, useState } from "react";
import { useCloseOnOutsideClick } from "../../utils/hooks/useCloseOnOutsideClick";
import {
  REVISION_DISPLAYS,
  type RevisionDisplay,
} from "../../settings/SettingsContext";
import { ChatTabIcon, ChevronIcon } from "../../ui/icons";
import { usePresenceProps } from "../../ui/usePresence";
import { useMarginAvailable } from "../margin/margin-room";
import {
  effectiveRevisionDisplay,
  marginViewBlocked,
  needsMargin,
} from "./revision-display";
import "./ReviewBar.css";

export interface ReviewBarLabels {
  revisionDisplayLabel: string;
  revisionDisplayNoRoom: string;
  reviewBarLabel: string;
  reviewBarOpenChat: string;
  proposalAccept: string;
  proposalReject: string;
  proposalAcceptSome: string;
  proposalChangeCount: string;
  quickAskPosition: string;
  quickAskPrevEdit: string;
  quickAskNextEdit: string;
}

/**
 * The pending edits' controls, floating over the bottom of the document
 * while there are any: step through the changed sentences (‹ 1/3 ›), then
 * Accept what wasn't kept or Reject them all. The text itself carries a
 * ✓ / ✕ per sentence; this is the one place to finish - the AI panel's
 * card has the same buttons, the panel no longer has a bar of its own.
 *
 * On a phone it is the AI sheet's collapsed form: a bottom bar with big
 * buttons and a way back into the conversation.
 */
export function ReviewBar({
  labels,
  taken,
  total,
  position,
  stops,
  phone,
  onPrevious,
  onNext,
  onAccept,
  onReject,
  onOpenChat,
  display,
  displayName,
  onDisplay,
}: {
  /** How revisions show (Settings.revisionDisplay), switched from here as
   *  in Word's Review ribbon. */
  display: RevisionDisplay;
  displayName: (mode: RevisionDisplay) => string;
  onDisplay: (mode: RevisionDisplay) => void;
  labels: ReviewBarLabels;
  /** Sentences Accept would take, of all pending ones. */
  taken: number;
  total: number;
  /** The pointer (-1: not on a stop yet) and how many stops there are. */
  position: number;
  stops: number;
  phone: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onAccept: () => void;
  onReject: () => void;
  /** Phone: back to the conversation. */
  onOpenChat?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const presence = usePresenceProps(rootRef);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useCloseOnOutsideClick<HTMLDivElement>(
    () => setMenuOpen(false),
    true,
    menuOpen,
  );
  // A phone has no margin: only the two views that need none. Elsewhere
  // the margin views stay listed while there is no room, unpickable, with
  // why - and a chosen one waits there while the text shows everything.
  const modes = phone
    ? REVISION_DISPLAYS.filter((m) => !needsMargin(m))
    : REVISION_DISPLAYS;
  const marginAvailable = useMarginAvailable();
  const noMargin = !phone && !marginAvailable;
  const shown = effectiveRevisionDisplay(display, !phone && marginAvailable);
  const waiting = noMargin && shown !== display;
  const noMarginId = useId();
  const view = (
    <div className="review-bar-view" ref={menuRef}>
      <button
        type="button"
        className={`review-bar-view-button${waiting ? " review-bar-view-waiting" : ""}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={
          waiting
            ? `${labels.revisionDisplayLabel}: ${displayName(shown)}`
            : labels.revisionDisplayLabel
        }
        title={
          waiting ? labels.revisionDisplayNoRoom : labels.revisionDisplayLabel
        }
        onClick={() => setMenuOpen(!menuOpen)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" />
          <circle cx="8" cy="8" r="2" />
        </svg>
        {/* The chosen view waits for room: what shows meanwhile. */}
        {waiting && (
          <span className="review-bar-view-name">{displayName(shown)}</span>
        )}
      </button>
      {menuOpen && (
        <div
          className="review-bar-menu floating-surface"
          role="menu"
          aria-label={labels.revisionDisplayLabel}
        >
          {modes.map((mode) => (
            <button
              key={mode}
              type="button"
              role="menuitemradio"
              aria-checked={shown === mode}
              disabled={marginViewBlocked(mode, { phone, marginAvailable })}
              aria-describedby={
                marginViewBlocked(mode, { phone, marginAvailable })
                  ? noMarginId
                  : undefined
              }
              className={
                waiting && mode === display
                  ? "review-bar-menu-waiting"
                  : undefined
              }
              onClick={() => {
                onDisplay(mode);
                setMenuOpen(false);
              }}
            >
              {displayName(mode)}
            </button>
          ))}
          {noMargin && (
            <p id={noMarginId} className="review-bar-menu-note">
              {labels.revisionDisplayNoRoom}
            </p>
          )}
        </div>
      )}
    </div>
  );
  const accept =
    taken < total
      ? labels.proposalAcceptSome
          .replace("{k}", String(taken))
          .replace("{n}", String(total))
      : labels.proposalAccept;
  const nav = stops > 1 && (
    <span className="review-bar-nav">
      <button
        type="button"
        aria-label={labels.quickAskPrevEdit}
        title={labels.quickAskPrevEdit}
        onClick={onPrevious}
      >
        <ChevronIcon className="review-bar-prev" />
      </button>
      <span className="review-bar-pos">
        {position < 0
          ? labels.proposalChangeCount.replace("{n}", String(stops))
          : labels.quickAskPosition
              .replace("{i}", String(position + 1))
              .replace("{n}", String(stops))}
      </span>
      <button
        type="button"
        aria-label={labels.quickAskNextEdit}
        title={labels.quickAskNextEdit}
        onClick={onNext}
      >
        <ChevronIcon className="review-bar-next" />
      </button>
    </span>
  );
  return (
    <div
      {...presence}
      className={`review-bar${phone ? " review-bar-phone" : ""}`}
      role="toolbar"
      aria-label={labels.reviewBarLabel}
    >
      <div className="review-bar-top">
        <span className="review-bar-label">{labels.reviewBarLabel}</span>
        {nav}
        {view}
        {phone && onOpenChat && (
          <button
            type="button"
            className="review-bar-chat"
            aria-label={labels.reviewBarOpenChat}
            title={labels.reviewBarOpenChat}
            onClick={onOpenChat}
          >
            <ChatTabIcon />
          </button>
        )}
      </div>
      {!phone && <span className="review-bar-sep" aria-hidden="true" />}
      <div className="review-bar-actions">
        <button
          type="button"
          className="review-bar-button review-bar-accept"
          onClick={onAccept}
        >
          {accept}
        </button>
        <button type="button" className="review-bar-button" onClick={onReject}>
          {labels.proposalReject}
        </button>
      </div>
    </div>
  );
}
