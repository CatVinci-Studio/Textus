import { fill } from "../../../i18n/fill";
import { useMenuButton } from "../../../engine/controls/useMenuButton";
import { ChevronIcon } from "../../../engine/controls/icons";
import { StepNav } from "../../../engine/controls/StepNav";

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
  /** How many edits are currently decidable (streaming ones excluded).
   *  Nothing renders when this is 0. */
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
 * Quick Ask's review-one-at-a-time bar, its only control for edits.
 * Accept/Reject act on the edit "i / n" points at; each ▾ offers the bulk
 * action.
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
        <StepNav
          className="quick-ask-pending-nav"
          previous={labels.quickAskPrevEdit}
          next={labels.quickAskNextEdit}
          onStep={(step) => (step < 0 ? onFocusPrevious() : onFocusNext())}
          position={fill(labels.quickAskPosition, {
            i: String(focusIndex + 1),
            n: String(total),
          })}
        />
      )}
      <div className="quick-ask-pending-actions">
        {total === 1 ? (
          // One edit: "all" means the same thing, so no menus.
          <>
            <button
              type="button"
              className="tx-button small inline-chat-action primary inline-chat-action-primary"
              onClick={onAcceptFocused}
            >
              {labels.proposalAccept}
            </button>
            <button
              type="button"
              className="tx-button small inline-chat-action"
              onClick={onRejectFocused}
            >
              {labels.proposalReject}
            </button>
          </>
        ) : (
          <>
            <SplitButton
              label={labels.proposalAccept}
              menuLabel={fill(labels.quickAskAcceptAllCount, {
                n: String(total),
              })}
              onClick={onAcceptFocused}
              onMenuClick={onAcceptAll}
              primary
            />
            <SplitButton
              label={labels.proposalReject}
              menuLabel={fill(labels.quickAskRejectAllCount, {
                n: String(total),
              })}
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
 *  the bulk variant of the same action. */
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
  // The one way a button hangs a menu (a sheet on a phone).
  const menu = useMenuButton(() => [
    { label: menuLabel, onSelect: onMenuClick },
  ]);
  return (
    <div className="quick-ask-split-button">
      <button
        type="button"
        className={`tx-button small inline-chat-action${primary ? " primary inline-chat-action-primary" : ""} quick-ask-split-main`}
        onClick={onClick}
      >
        {label}
      </button>
      <button
        type="button"
        className={`tx-button small inline-chat-action${primary ? " primary inline-chat-action-primary" : ""} quick-ask-split-chevron`}
        aria-label={menuLabel}
        {...menu.button}
      >
        <ChevronIcon className="quick-ask-split-chevron-icon" />
      </button>
      {menu.menu}
    </div>
  );
}
