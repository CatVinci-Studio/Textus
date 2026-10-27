import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "../settings/SettingsContext";
import { usePresenceProps } from "./usePresence";
import "./ActionSheet.css";

export interface ActionSheetItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * The iPhone's form of a menu, UIKit's action sheet. ContextMenu renders this
 * on a phone, so every menu built from its items gets it. A tap outside or on
 * Cancel closes it; picking an action runs it and closes.
 */
export function ActionSheet({
  title,
  items,
  onClose,
}: {
  title?: string;
  items: (ActionSheetItem | "separator")[];
  onClose: () => void;
}) {
  const { t } = useSettings();
  const presence = usePresenceProps<HTMLDivElement>();
  const open = presence["data-state"] === "open";
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  // Separators split the list into groups, as UIKit draws them.
  const groups: ActionSheetItem[][] = [[]];
  for (const item of items) {
    if (item === "separator") groups.push([]);
    else groups[groups.length - 1].push(item);
  }

  return createPortal(
    <div
      {...presence}
      className="action-sheet-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="action-sheet" role="menu" aria-label={title}>
        <div className="action-sheet-group">
          {title && <div className="action-sheet-title">{title}</div>}
          {groups
            .filter((group) => group.length > 0)
            .map((group, g) => (
              <div key={g} className="action-sheet-section">
                {group.map((item, i) => (
                  <button
                    key={i}
                    type="button"
                    role="menuitem"
                    className={`action-sheet-item${item.danger ? " action-sheet-item-danger" : ""}`}
                    onClick={() => {
                      onClose();
                      item.onSelect();
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
        </div>
        <button
          type="button"
          className="action-sheet-item action-sheet-cancel"
          onClick={onClose}
        >
          {t.cancel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
