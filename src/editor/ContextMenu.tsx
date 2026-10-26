import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { useCloseOnOutsideClick } from "../utils/hooks/useCloseOnOutsideClick";
import { useViewportClamp } from "../utils/hooks/useViewportClamp";
import { ActionSheet } from "../ui/ActionSheet";
import { usePhoneLayout } from "../ui/usePhoneLayout";
import { usePresenceProps, usePresenceState } from "../ui/usePresence";
import { CheckIcon } from "../ui/icons";
import "./ContextMenu.css";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  /** One choice of several, marked with a check while it is in force. */
  checked?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: (ContextMenuItem | "separator")[];
  onClose: () => void;
  /** Heads the phone's action sheet (a file's name, say); unused by the
   *  menu at the pointer, which shows where it was opened. */
  title?: string;
  /** Opened from the keyboard: focus moves to the first item and back once
   *  the menu closes. */
  keyboard?: boolean;
}

/** A menu at the pointer, or on a phone an action sheet. Render it inside a
 *  Presence for its exit. */
export function ContextMenu(props: ContextMenuProps) {
  const phone = usePhoneLayout();
  if (phone)
    return (
      <ActionSheet
        title={props.title}
        items={props.items}
        onClose={props.onClose}
      />
    );
  return <PointerMenu {...props} />;
}

function PointerMenu({ x, y, items, onClose, keyboard }: ContextMenuProps) {
  // On its way out it no longer answers Escape: the next press belongs to
  // whatever is under it (the find bar, a dialog).
  const open = usePresenceState() === "open";
  const ref = useCloseOnOutsideClick<HTMLDivElement>(onClose, true, open);
  const pos = useViewportClamp(ref, x, y);
  const presence = usePresenceProps(ref);
  // It grows out of the point that was clicked - a corner, unless the menu
  // was pulled back from a window edge.
  const origin = {
    "--transform-origin": `${Math.max(0, x - pos.left)}px ${Math.max(0, y - pos.top)}px`,
  } as CSSProperties;

  // Closing hands the focus back to what had it as the menu opened, unless
  // the chosen item took it somewhere else (a dialog).
  const [opener] = useState(() =>
    keyboard ? (document.activeElement as HTMLElement | null) : null,
  );
  const giveBack = useCallback(() => {
    const at = document.activeElement;
    if (
      opener?.isConnected &&
      (!at || at === document.body || ref.current?.contains(at))
    )
      opener.focus({ preventScroll: true });
  }, [opener, ref]);
  useEffect(() => {
    if (!opener) return;
    ref.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    return giveBack;
  }, [opener, ref, giveBack]);
  useEffect(() => {
    if (!open) giveBack();
  }, [open, giveBack]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const rows = Array.from(
      ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [],
    );
    const at = rows.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    if (e.key === "ArrowDown") next = rows[(at + 1) % rows.length];
    else if (e.key === "ArrowUp")
      next = rows[(at - 1 + rows.length) % rows.length];
    else if (e.key === "Home") next = rows[0];
    else if (e.key === "End") next = rows[rows.length - 1];
    else if (e.key === "Tab") {
      // A menu is left with Escape or a choice, not walked out of.
      e.preventDefault();
      return;
    } else if (e.key === "Escape") {
      // Closed here: the document's listener is re-armed a tick after each
      // render, and an Escape in that gap was lost.
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    } else return;
    e.preventDefault();
    next?.focus();
  }

  return (
    <div
      {...presence}
      className="context-menu floating-surface"
      role="menu"
      style={{ ...pos, ...origin }}
      onKeyDown={onKeyDown}
      // A press on an item doesn't take the focus: on Linux the button kept it,
      // and once the menu closed it fell to the page.
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={i} className="context-menu-separator" role="separator" />
        ) : (
          <button
            key={i}
            role={item.checked === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={item.checked}
            tabIndex={-1}
            className={`context-menu-item ${item.danger ? "context-menu-item-danger" : ""}`}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            {item.checked !== undefined && (
              <CheckIcon
                className={`context-menu-check${item.checked ? "" : " context-menu-check-off"}`}
              />
            )}
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
