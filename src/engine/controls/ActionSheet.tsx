import { useSettings } from "../../prefs/SettingsContext";
import { CheckIcon } from "./icons";
import { Sheet } from "./Sheet";
import "./ActionSheet.css";

interface ActionSheetItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  /** One choice of several: a check beside the one in force. */
  checked?: boolean;
  /** Shown but not offered now. */
  disabled?: boolean;
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
  // Separators split the list into groups, as UIKit draws them.
  const groups: ActionSheetItem[][] = [[]];
  for (const item of items) {
    if (item === "separator") groups.push([]);
    else groups[groups.length - 1].push(item);
  }

  return (
    <Sheet role="menu" label={title} className="action-sheet" onClose={onClose}>
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
                  role={
                    item.checked === undefined ? "menuitem" : "menuitemradio"
                  }
                  aria-checked={item.checked}
                  // The one in force in view, however long the list.
                  ref={
                    item.checked
                      ? (el) => el?.scrollIntoView?.({ block: "nearest" })
                      : undefined
                  }
                  disabled={item.disabled}
                  className={`action-sheet-item${item.danger ? " action-sheet-item-danger" : ""}`}
                  onClick={() => {
                    onClose();
                    item.onSelect();
                  }}
                >
                  {item.label}
                  {item.checked && (
                    <CheckIcon className="action-sheet-check" aria-hidden />
                  )}
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
    </Sheet>
  );
}
