import { useState } from "react";
import { ChevronIcon } from "../../../ui/icons";
import { useCloseOnOutsideClick } from "../../../utils/hooks/useCloseOnOutsideClick";
import { Presence, PresenceDiv } from "../../../ui/usePresence";
import { ActionSheet } from "../../../ui/ActionSheet";
import { usePhoneLayout } from "../../../ui/usePhoneLayout";
import { Tooltip } from "../../../ui/Tooltip";

export interface QuickAskPendingBarLabels {
  proposalAccept: string;
  proposalReject: string;
  /** "{i} / {n}" position indicator between the nav arrows. */
  quickAskPosition: string;
  quickAskPrevEdit: string;
  quickAskNextEdit: string;
  /** "{n}" is the total about to be accepted/rejected. */
  quickAskAcceptAllCount: string;
  quickAskRejectAllCount: string;
}

interface QuickAskPendingBarProps {
  /** How many edits are currently decidable (streaming ones excluded - see
   *  usePendingEdits.decidable). Nothing renders when this is 0. */
  total: number;
  /** 0-based position of the currently focused edit within the navigable
   *  set, or -1 if none is focused yet. */
  focusIndex: number;
  onFocusNext: () => void;
  onFocusPrevious: () => void;
  onAcceptFocused: () => void;
  onRejectFocused: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  labels: QuickAskPendingBarLabels;
}

/**
 * Quick Ask's review-one-at-a-time bar - the ONE control surface for edits
 * in this surface (no proposal cards render alongside it here, unlike the
 * detached window). Accept/Reject act on whichever edit the "i / n"
 * indicator currently points at; each one's small ▾ opens a single-item
 * menu for the bulk action ("Accept all (N)" / "Reject all (N)").
 */
export function QuickAskPendingBar({
  total,
  focusIndex,
  onFocusNext,
  onFocusPrevious,
  onAcceptFocused,
  onRejectFocused,
  onAcceptAll,
  onRejectAll,
  labels,
}: QuickAskPendingBarProps) {
  if (total === 0) return null;

  return (
    <div className="quick-ask-pending-bar">
      {total > 1 && (
        <div className="quick-ask-pending-nav">
          <Tooltip text={labels.quickAskPrevEdit}>
            <button
              type="button"
              className="quick-ask-pending-nav-button"
              aria-label={labels.quickAskPrevEdit}
              onClick={onFocusPrevious}
            >
              ‹
            </button>
          </Tooltip>
          <span className="quick-ask-pending-position">
            {labels.quickAskPosition
              .replace("{i}", String(focusIndex + 1))
              .replace("{n}", String(total))}
          </span>
          <Tooltip text={labels.quickAskNextEdit}>
            <button
              type="button"
              className="quick-ask-pending-nav-button"
              aria-label={labels.quickAskNextEdit}
              onClick={onFocusNext}
            >
              ›
            </button>
          </Tooltip>
        </div>
      )}
      <div className="quick-ask-pending-actions">
        {total === 1 ? (
          // One edit: "all" means the same thing, so no menus.
          <>
            <button
              type="button"
              className="inline-chat-action inline-chat-action-primary"
              onClick={onAcceptFocused}
            >
              {labels.proposalAccept}
            </button>
            <button
              type="button"
              className="inline-chat-action"
              onClick={onRejectFocused}
            >
              {labels.proposalReject}
            </button>
          </>
        ) : (
          <>
            <SplitButton
              label={labels.proposalAccept}
              menuLabel={labels.quickAskAcceptAllCount.replace(
                "{n}",
                String(total),
              )}
              onClick={onAcceptFocused}
              onMenuClick={onAcceptAll}
              primary
            />
            <SplitButton
              label={labels.proposalReject}
              menuLabel={labels.quickAskRejectAllCount.replace(
                "{n}",
                String(total),
              )}
              onClick={onRejectFocused}
              onMenuClick={onRejectAll}
            />
          </>
        )}
      </div>
    </div>
  );
}

/** A primary action button with a chevron that opens a single-item menu for
 *  the bulk variant of the same action ("Accept" -> chevron -> "Accept all
 *  (N)"). Generic enough to serve both Accept and Reject without knowing
 *  which one it is. */
function SplitButton({
  label,
  menuLabel,
  onClick,
  onMenuClick,
  primary,
}: {
  label: string;
  menuLabel: string;
  onClick: () => void;
  onMenuClick: () => void;
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // A phone shows the bulk action as an action sheet, which closes itself;
  // the outside-click hook would count a tap on it (portalled to <body>)
  // as outside and swallow the choice.
  const phone = usePhoneLayout();
  const ref = useCloseOnOutsideClick<HTMLDivElement>(
    () => setOpen(false),
    false,
    open && !phone,
  );

  return (
    <div className="quick-ask-split-button" ref={ref}>
      <button
        type="button"
        className={`inline-chat-action${primary ? " inline-chat-action-primary" : ""} quick-ask-split-main`}
        onClick={onClick}
      >
        {label}
      </button>
      <button
        type="button"
        className={`inline-chat-action${primary ? " inline-chat-action-primary" : ""} quick-ask-split-chevron`}
        aria-label={menuLabel}
        onClick={() => setOpen((prev) => !prev)}
      >
        <ChevronIcon className="quick-ask-split-chevron-icon" />
      </button>
      <Presence show={open && phone} exitMs={250}>
        {open && phone && (
          <ActionSheet
            items={[{ label: menuLabel, onSelect: onMenuClick }]}
            onClose={() => setOpen(false)}
          />
        )}
      </Presence>
      <Presence show={open && !phone} exitMs={120}>
        {open && !phone && (
          <PresenceDiv className="quick-ask-split-menu floating-surface">
            <button
              type="button"
              className="quick-ask-split-menu-item"
              onClick={() => {
                setOpen(false);
                onMenuClick();
              }}
            >
              {menuLabel}
            </button>
          </PresenceDiv>
        )}
      </Presence>
    </div>
  );
}
