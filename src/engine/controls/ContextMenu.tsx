import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useCloseOnOutsideClick } from "../../utils/hooks/useCloseOnOutsideClick";
import { usePlacement } from "./usePlacement";
import { usePhoneLayout } from "./usePhoneLayout";
import { usePresenceProps, usePresenceState } from "../motion/usePresence";
import { menuHost, MenuPanel } from "./menu-panel";
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
  /** A row deeper in a hierarchy (an outline's heading, 1 the top): its
   *  label set in by the level. */
  depth?: number;
  /** The row being read, ticked without `checked`'s choice-of-several
   *  meaning; false keeps the tick's column. */
  current?: boolean;
}

/** Items shown beside the row when it is hovered or opened; a group in
 *  them opens beside them in turn. */
export interface ContextMenuGroup {
  label: string;
  items: ContextMenuEntry[];
  disabled?: boolean;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuGroup | "separator";

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
  /** Its accessible name where no heading shows (a file's, a select's). */
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
}

/** A menu at the pointer, a phone's too, its submenus opening in place
 *  under their rows (no room beside). Render it inside a Presence for its
 *  exit. */
export function ContextMenu(props: ContextMenuProps) {
  const phone = usePhoneLayout();
  return <PointerMenu {...props} inline={phone} items={tidy(props.items)} />;
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
  title,
}: ContextMenuProps & { inline: boolean }) {
  // On its way out it no longer answers Escape: the next press belongs to
  // whatever is under it (the find bar, a dialog).
  const open = usePresenceState() === "open";
  // A phone's menu opened while typing (the format bar's ⋯) puts the
  // keyboard down, and gives it back once it closes, unless what was chosen
  // took the focus elsewhere. In the closing tap, so iOS lets it come back.
  const [typing] = useState(() => (inline && !keyboard ? typingIn() : null));
  const close = useCallback(() => {
    onClose();
    const at = document.activeElement;
    if (typing?.isConnected && (!at || at === document.body))
      typing.focus({ preventScroll: true });
  }, [onClose, typing]);
  const ref = useCloseOnOutsideClick<HTMLDivElement>(
    close,
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
  // On a phone the menu takes the focus from a field: the keyboard goes
  // down, and nothing typed lands behind the menu.
  useLayoutEffect(() => {
    if (inline && !keyboard) (document.activeElement as HTMLElement)?.blur?.();
  }, [inline, keyboard]);

  // Out of its opener: an ancestor's clip (a tab row's) would cut it.
  return createPortal(
    <MenuPanel
      items={items}
      onClose={close}
      inline={inline}
      panelRef={ref}
      surface={presence}
      className="context-menu floating-surface"
      style={{ ...pos, ...origin }}
      label={heading ?? title}
      heading={heading && <div className="context-menu-heading">{heading}</div>}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        // Closed here: the document's listener is re-armed a tick after
        // each render, and an Escape in that gap was lost.
        e.preventDefault();
        e.stopPropagation();
        close();
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

/** The text being typed in now: an editor or a field. */
function typingIn(): HTMLElement | null {
  const at = document.activeElement as HTMLElement | null;
  return at?.isContentEditable || at?.matches("input, textarea") ? at : null;
}
