import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useCloseOnOutsideClick } from "../../utils/hooks/useCloseOnOutsideClick";
import { usePlacement } from "./usePlacement";
import { ActionSheet } from "./ActionSheet";
import { usePhoneLayout } from "./usePhoneLayout";
import { usePresenceProps, usePresenceState } from "../motion/usePresence";
import { isMenuGroup, menuHost, MenuPanel } from "./menu-panel";
import "./ContextMenu.css";

export interface ContextMenuItem {
  label: string;
  /** The click's keys too: ⌘/Ctrl opens a recent folder in a new window. */
  onSelect: (e?: { metaKey: boolean; ctrlKey: boolean }) => void;
  danger?: boolean;
  /** Marked with a check while it is in force. */
  checked?: boolean;
  /** `checked` is an on/off (a view mode), not one choice of several. */
  toggle?: boolean;
  /** Shown but not offered now (Copy with nothing selected). */
  disabled?: boolean;
  /** The keys that do it too, as shown ("Ctrl+S"). */
  accel?: string;
  /** The whole label on hover, where it is shortened (a recent file). */
  hint?: string;
}

/** Items shown beside the row when it is hovered or opened; a group in
 *  them opens beside them in turn. */
export interface ContextMenuGroup {
  label: string;
  items: ContextMenuEntry[];
  disabled?: boolean;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuGroup | "separator";

/** A phone's sheet has no submenus: each group's items stand in its place. */
function flatMenu(
  entries: ContextMenuEntry[],
): (ContextMenuItem | "separator")[] {
  const flat: (ContextMenuItem | "separator")[] = [];
  for (const entry of entries) {
    if (!isMenuGroup(entry)) flat.push(entry);
    else flat.push("separator", ...flatMenu(entry.items), "separator");
  }
  return tidy(flat);
}

/** No rule at either end or twice in a row, however the menu was built. */
export function tidy<T>(entries: readonly (T | "separator")[]) {
  const out: (T | "separator")[] = [];
  for (const entry of entries)
    if (entry !== "separator" || (out.length && out.at(-1) !== "separator"))
      out.push(entry);
  if (out.at(-1) === "separator") out.pop();
  return out;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
  /** Heads the phone's action sheet (a file's name, say); unused by the
   *  menu at the pointer, which shows where it was opened. */
  title?: string;
  /** Opened from the keyboard: focus moves to the first item and back once
   *  the menu closes. */
  keyboard?: boolean;
  /** The button it hangs from (useMenuButton): a press on it is the
   *  button's, which closes the menu, not an outside click. */
  anchor?: HTMLElement | null;
  /** Hanging from a button at the end of a bar: `x` is the menu's right
   *  edge. */
  alignEnd?: boolean;
  /** A heading row naming the menu (a plugin's status menu); also its
   *  accessible name. */
  heading?: string;
  /** On a phone, a menu whose submenus open in place under their rows
   *  (the window's menu), rather than an action sheet. */
  inline?: boolean;
}

/** A menu at the pointer, or on a phone an action sheet. Render it inside a
 *  Presence for its exit. */
export function ContextMenu(props: ContextMenuProps) {
  const phone = usePhoneLayout();
  if (phone && !props.inline)
    return (
      <ActionSheet
        title={props.title}
        items={flatMenu(props.items)}
        onClose={props.onClose}
      />
    );
  return (
    <PointerMenu
      {...props}
      inline={phone && props.inline}
      items={tidy(props.items)}
    />
  );
}

function PointerMenu({
  x,
  y,
  items,
  onClose,
  keyboard,
  anchor,
  alignEnd,
  heading,
  inline,
}: ContextMenuProps) {
  // On its way out it no longer answers Escape: the next press belongs to
  // whatever is under it (the find bar, a dialog).
  const open = usePresenceState() === "open";
  const ref = useCloseOnOutsideClick<HTMLDivElement>(
    onClose,
    true,
    open,
    anchor ?? "",
  );
  const pos = usePlacement(ref, x, y, {
    alignEnd,
    anchor: () => anchor,
  });
  const presence = usePresenceProps(ref);
  // It grows out of the point that was clicked - a corner, unless the menu
  // was pulled back from a window edge.
  const origin = {
    "--transform-origin": `${Math.max(0, x - pos.left)}px ${Math.max(0, y - pos.top)}px`,
  } as CSSProperties;

  useFocusReturn(ref, keyboard, open);

  // Out of its opener: an ancestor's clip (a tab row's) would cut it.
  return createPortal(
    <MenuPanel
      items={items}
      onClose={onClose}
      inline={inline}
      panelRef={ref}
      surface={presence}
      className="context-menu floating-surface"
      style={{ ...pos, ...origin }}
      label={heading}
      heading={heading && <div className="context-menu-heading">{heading}</div>}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        // Closed here: the document's listener is re-armed a tick after
        // each render, and an Escape in that gap was lost.
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    />,
    menuHost(anchor),
  );
}

/** Opened from the keyboard, the first item takes the focus, and closing
 *  hands it back to what had it, unless the chosen item took it elsewhere
 *  (a dialog). */
function useFocusReturn(
  ref: RefObject<HTMLDivElement | null>,
  keyboard: boolean | undefined,
  open: boolean,
) {
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
    ref.current
      ?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')
      ?.focus();
    return giveBack;
  }, [opener, ref, giveBack]);
  useEffect(() => {
    if (!open) giveBack();
  }, [open, giveBack]);
}
