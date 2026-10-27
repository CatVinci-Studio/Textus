import { useId, useRef, useState } from "react";
import { useCloseOnOutsideClick } from "../../utils/hooks/useCloseOnOutsideClick";
import {
  REVISION_DISPLAYS,
  type RevisionDisplay,
} from "../../prefs/SettingsContext";
import { AssistantIcon, ChevronIcon } from "../../ui/icons";
import { usePresenceProps } from "../../ui/usePresence";
import { useMarginAvailable } from "../margin/margin-room";
import {
  effectiveRevisionDisplay,
  marginViewBlocked,
  needsMargin,
} from "./revision-display";
import { Tooltip } from "../../ui/Tooltip";
import { ThinkingIndicator } from "../chat/ThinkingIndicator";
import "./ReviewBar.css";

export interface ReviewBarLabels {
  revisionDisplayLabel: string;
  revisionDisplayNoRoom: string;
  revisionDisplayNewText: string;
  reviewBarLabel: string;
  reviewBarOpenChat: string;
  proposalAccept: string;
  proposalPicturePainting: string;
  proposalReject: string;
  proposalAcceptSome: string;
  proposalChangeCount: string;
  quickAskPosition: string;
  quickAskPrevEdit: string;
  quickAskNextEdit: string;
  /** In place of the bar's name while a rewrite is still being written. */
  agentWritingEdit: string;
}

/** The pending edits' controls over the bottom of the document: step through
 *  the changes, then Accept or Reject. On a phone, the AI sheet's collapsed form. */
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
  newText,
  streaming,
  painting,
}: {
  /** A picture in a pending proposal is still being made: Accept waits
   *  for it, and says so. */
  painting: boolean;
  /** A rewrite is still streaming in: Accept / Reject wait until it is all
   *  in, though its changes can be stepped through as they come. */
  streaming: boolean;
  /** Some pending proposal is new text alone, which stays in the text in the
   *  margin views; the menu says so. */
  newText: boolean;
  /** How revisions show. */
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
  // A phone lists only the views needing no margin. Elsewhere margin views
  // stay listed without room, unpickable, and a chosen one waits.
  const modes = phone
    ? REVISION_DISPLAYS.filter((m) => !needsMargin(m))
    : REVISION_DISPLAYS;
  const marginAvailable = useMarginAvailable();
  const noMargin = !phone && !marginAvailable;
  const shown = effectiveRevisionDisplay(
    display,
    !phone && marginAvailable,
    phone,
  );
  const waiting = noMargin && shown !== display;
  const noMarginId = useId();
  const newTextId = useId();
  const newTextNote = newText && !phone;
  const view = (
    <div className="review-bar-view" ref={menuRef}>
      <Tooltip
        side="above"
        text={
          waiting ? labels.revisionDisplayNoRoom : labels.revisionDisplayLabel
        }
      >
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
      </Tooltip>
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
                [
                  marginViewBlocked(mode, { phone, marginAvailable }) &&
                    noMarginId,
                  newTextNote && needsMargin(mode) && newTextId,
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
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
          {newTextNote && (
            <p id={newTextId} className="review-bar-menu-note">
              {labels.revisionDisplayNewText}
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
  // Once shown, the count stays, even if the rewrite ends with one change.
  const [counted, setCounted] = useState(false);
  if (!counted && (stops > 1 || streaming)) setCounted(true);
  const nav = (counted || stops > 1 || streaming) && (
    <span className="review-bar-nav">
      <Tooltip text={labels.quickAskPrevEdit} side="above">
        <button
          type="button"
          aria-label={labels.quickAskPrevEdit}
          disabled={stops < 2}
          onClick={onPrevious}
        >
          <ChevronIcon className="review-bar-prev" />
        </button>
      </Tooltip>
      <span className="review-bar-pos">
        {position < 0
          ? labels.proposalChangeCount.replace("{n}", String(stops))
          : labels.quickAskPosition
              .replace("{i}", String(position + 1))
              .replace("{n}", String(stops))}
      </span>
      <Tooltip text={labels.quickAskNextEdit} side="above">
        <button
          type="button"
          aria-label={labels.quickAskNextEdit}
          disabled={stops < 2}
          onClick={onNext}
        >
          <ChevronIcon className="review-bar-next" />
        </button>
      </Tooltip>
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
        {/* While a rewrite is still written, the bar says so in its name's place. */}
        {streaming ? (
          <span className="review-bar-label review-bar-working" role="status">
            <ThinkingIndicator label={labels.agentWritingEdit} />
          </span>
        ) : (
          <span className="review-bar-label">{labels.reviewBarLabel}</span>
        )}
        {nav}
        {view}
        {phone && onOpenChat && (
          <Tooltip text={labels.reviewBarOpenChat} side="above">
            <button
              type="button"
              className="review-bar-chat"
              aria-label={labels.reviewBarOpenChat}
              onClick={onOpenChat}
            >
              <AssistantIcon />
            </button>
          </Tooltip>
        )}
      </div>
      {!phone && <span className="review-bar-sep" aria-hidden="true" />}
      <div className="review-bar-actions">
        <button
          type="button"
          className="review-bar-button review-bar-accept"
          disabled={streaming || painting}
          onClick={onAccept}
        >
          {painting ? labels.proposalPicturePainting : accept}
        </button>
        <button
          type="button"
          className="review-bar-button"
          disabled={streaming}
          onClick={onReject}
        >
          {labels.proposalReject}
        </button>
      </div>
    </div>
  );
}
