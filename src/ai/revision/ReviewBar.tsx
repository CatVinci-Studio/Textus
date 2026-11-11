import { counted as inWords } from "../../i18n/current";
import type { Plural } from "../../i18n/plural";
import { fill } from "../../i18n/fill";
import { useRef, useState } from "react";
import { useMenuButton } from "../../engine/controls/useMenuButton";
import {
  REVISION_DISPLAYS,
  type RevisionDisplay,
} from "../../prefs/SettingsContext";
import {
  AssistantIcon,
  ChevronIcon,
  EyeIcon,
} from "../../engine/controls/icons";
import { usePresenceProps } from "../../engine/motion/usePresence";
import { useMarginAvailable } from "../margin/margin-room";
import {
  effectiveRevisionDisplay,
  marginViewBlocked,
  needsMargin,
} from "./revision-display";
import { Tooltip } from "../../engine/controls/Tooltip";
import { ThinkingIndicator } from "../chat/ThinkingIndicator";
import type { NotesBarState } from "../margin/useNotesBar";
import "./ReviewBar.css";

interface ReviewBarLabels {
  revisionDisplayLabel: string;
  revisionDisplayNoRoom: string;
  reviewBarLabel: string;
  reviewBarOpenChat: string;
  proposalAccept: string;
  proposalPicturePainting: string;
  proposalReject: string;
  proposalAcceptSome: string;
  proposalChangeCount: Plural;
  quickAskPosition: string;
  quickAskPrevEdit: string;
  quickAskNextEdit: string;
  /** In place of the bar's name while a rewrite is still being written. */
  agentWritingEdit: string;
  reviewNotesLabel: string;
  reviewGroupNotes: Plural;
  reviewNotesPick: string;
  reviewNotesAllDone: string;
  reviewNotesPicked: string;
  reviewNoteAsk: string;
  cancel: string;
}

/** The changes waiting: what Accept and Reject do, and how they show. */
export interface BarChanges {
  /** Sentences Accept would take, of all pending ones. */
  taken: number;
  total: number;
  onAccept: () => void;
  onReject: () => void;
  /** A rewrite still streaming in: Accept / Reject wait until it is all
   *  in, though its changes can be stepped through as they come. */
  streaming: boolean;
  /** A picture in a pending proposal is still being made. */
  painting: boolean;
  display: RevisionDisplay;
  displayName: (mode: RevisionDisplay) => string;
  onDisplay: (mode: RevisionDisplay) => void;
}

/** The notes waiting: marked done together, or picked to ask about. */
interface BarNotes {
  count: number;
  bar: NotesBarState;
  /** Picking needs the margin's cards (not a phone's badges). */
  canPick: boolean;
}

/**
 * One bar over the bottom of the document for everything waiting in it:
 * the changes (Textus AI's, else the writer's own) and the review notes,
 * stepped through together in the document's order; then Accept or Reject
 * the changes, and mark the notes done or pick some to ask about. On a
 * phone, the AI sheet's collapsed form.
 */
export function ReviewBar({
  labels,
  phone,
  position,
  stops,
  onPrevious,
  onNext,
  changes,
  notes,
  onOpenChat,
}: {
  labels: ReviewBarLabels;
  phone: boolean;
  /** The pointer among all the stops (-1: not on one yet), and how many. */
  position: number;
  stops: number;
  onPrevious: () => void;
  onNext: () => void;
  changes: BarChanges | null;
  notes: BarNotes | null;
  /** Phone: back to the conversation. */
  onOpenChat?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const presence = usePresenceProps(rootRef);
  // A phone lists only the views needing no margin. Elsewhere margin views
  // stay listed without room, unpickable, and a chosen one waits.
  const modes = phone
    ? REVISION_DISPLAYS.filter((m) => !needsMargin(m))
    : REVISION_DISPLAYS;
  const marginAvailable = useMarginAvailable();
  const noMargin = !phone && !marginAvailable;
  const display = changes?.display ?? "final";
  const displayName = changes?.displayName ?? String;
  const onDisplay = changes?.onDisplay ?? (() => undefined);
  const shown = effectiveRevisionDisplay(
    display,
    !phone && marginAvailable,
    phone,
  );
  const waiting = noMargin && shown !== display;
  const streaming = !!changes?.streaming;
  const picking = !!notes && notes.bar.picked !== null;
  // Once shown, the count stays, even if the rewrite ends with one change.
  const [counted, setCounted] = useState(false);
  if (!counted && (stops > 1 || streaming)) setCounted(true);
  // Without room for a margin, the menu's title says why its margin views
  // can't be picked.
  const menu = useMenuButton(
    () =>
      modes.map((mode) => ({
        label: displayName(mode),
        checked: shown === mode,
        disabled: marginViewBlocked(mode, { phone, marginAvailable }),
        onSelect: () => onDisplay(mode),
      })),
    {
      title: noMargin
        ? labels.revisionDisplayNoRoom
        : labels.revisionDisplayLabel,
    },
  );
  const view = (
    <div className="review-bar-view">
      <Tooltip
        side="above"
        text={
          waiting ? labels.revisionDisplayNoRoom : labels.revisionDisplayLabel
        }
      >
        <button
          type="button"
          className={`review-bar-view-button${waiting ? " review-bar-view-waiting" : ""}`}
          aria-label={
            waiting
              ? `${labels.revisionDisplayLabel}: ${displayName(shown)}`
              : labels.revisionDisplayLabel
          }
          {...menu.button}
        >
          <EyeIcon aria-hidden />
          {/* The chosen view waits for room: what shows meanwhile. */}
          {waiting && (
            <span className="review-bar-view-name">{displayName(shown)}</span>
          )}
        </button>
      </Tooltip>
      {menu.menu}
    </div>
  );
  const counts = [
    changes && inWords(labels.proposalChangeCount, changes.total),
    notes && inWords(labels.reviewGroupNotes, notes.count),
  ]
    .filter(Boolean)
    .join(" · ");
  const nav = (counted || stops > 1 || streaming) && !picking && (
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
          ? counts
          : fill(labels.quickAskPosition, {
              i: String(position + 1),
              n: String(stops),
            })}
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
  const name = picking
    ? fill(labels.reviewNotesPicked, {
        n: String(notes!.bar.picked?.size ?? 0),
      })
    : changes && notes
      ? `${labels.reviewBarLabel} · ${labels.reviewNotesLabel}`
      : changes
        ? labels.reviewBarLabel
        : labels.reviewNotesLabel;
  return (
    <div
      {...presence}
      className={`review-bar${phone ? " review-bar-phone" : ""}`}
      role="toolbar"
      aria-label={name}
    >
      <div className="review-bar-top">
        {/* While a rewrite is still written, the bar says so in its name's place. */}
        {streaming ? (
          <span className="review-bar-label review-bar-working" role="status">
            <ThinkingIndicator label={labels.agentWritingEdit} />
          </span>
        ) : (
          <span className="review-bar-label">{name}</span>
        )}
        {nav}
        {changes && !picking && view}
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
        {picking ? (
          <>
            <button
              type="button"
              className="review-bar-button review-bar-primary"
              disabled={(notes!.bar.picked?.size ?? 0) === 0}
              onClick={notes!.bar.askPicked}
            >
              {labels.reviewNoteAsk}
            </button>
            <button
              type="button"
              className="review-bar-button"
              onClick={notes!.bar.stopPicking}
            >
              {labels.cancel}
            </button>
          </>
        ) : (
          <>
            {changes && (
              <>
                <button
                  type="button"
                  className="review-bar-button review-bar-accept"
                  disabled={streaming || changes.painting}
                  onClick={changes.onAccept}
                >
                  {changes.painting
                    ? labels.proposalPicturePainting
                    : changes.taken < changes.total
                      ? fill(labels.proposalAcceptSome, {
                          k: String(changes.taken),
                          n: String(changes.total),
                        })
                      : labels.proposalAccept}
                </button>
                <button
                  type="button"
                  className="review-bar-button"
                  disabled={streaming}
                  onClick={changes.onReject}
                >
                  {labels.proposalReject}
                </button>
              </>
            )}
            {notes && notes.canPick && notes.count > 1 && (
              <button
                type="button"
                className="review-bar-button"
                onClick={notes.bar.startPicking}
              >
                {labels.reviewNotesPick}
              </button>
            )}
            {notes && (
              <button
                type="button"
                className={`review-bar-button${changes ? "" : " review-bar-primary"}`}
                onClick={notes.bar.allDone}
              >
                {labels.reviewNotesAllDone}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
