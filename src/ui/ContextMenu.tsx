import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useCloseOnOutsideClick } from "../utils/hooks/useCloseOnOutsideClick";
import { useViewportClamp } from "../utils/hooks/useViewportClamp";
import { ActionSheet } from "./ActionSheet";
import { usePhoneLayout } from "./usePhoneLayout";
import { usePresenceProps, usePresenceState } from "./usePresence";
import { CheckIcon, ChevronIcon } from "./icons";
import "./ContextMenu.css";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  /** One choice of several, marked with a check while it is in force. */
  checked?: boolean;
}

/** Items shown beside the menu when the row is hovered or opened. */
export interface ContextMenuGroup {
  label: string;
  items: (ContextMenuItem | "separator")[];
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuGroup | "separator";

export function isMenuGroup(
  entry: ContextMenuEntry,
): entry is ContextMenuGroup {
  return typeof entry === "object" && "items" in entry;
}

/** A phone's sheet has no submenus: each group's items stand in its place. */
export function flatMenu(
  entries: ContextMenuEntry[],
): (ContextMenuItem | "separator")[] {
  const flat: (ContextMenuItem | "separator")[] = [];
  for (const entry of entries) {
    if (!isMenuGroup(entry)) flat.push(entry);
    else flat.push("separator", ...entry.items, "separator");
  }
  return flat.filter(
    (entry, i) =>
      entry !== "separator" ||
      (i > 0 && i < flat.length - 1 && flat[i + 1] !== "separator"),
  );
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
}

/** A menu at the pointer, or on a phone an action sheet. Render it inside a
 *  Presence for its exit. */
export function ContextMenu(props: ContextMenuProps) {
  const phone = usePhoneLayout();
  if (phone)
    return (
      <ActionSheet
        title={props.title}
        items={flatMenu(props.items)}
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

  useFocusReturn(ref, keyboard, open);

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
    else if (e.key === "ArrowRight") {
      const group = rows[at]?.dataset.group;
      if (group !== undefined) {
        e.preventDefault();
        setOpenGroup({ index: Number(group), focus: true });
      }
      return;
    } else if (e.key === "Tab") {
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

  const { openGroup, setOpenGroup, rowRefs, hover, holdHover } = useSubmenu();
  const group = openGroup ? items[openGroup.index] : undefined;

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
        ) : isMenuGroup(item) ? (
          <button
            key={i}
            ref={(el) => {
              if (el) rowRefs.current.set(i, el);
              else rowRefs.current.delete(i);
            }}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openGroup?.index === i}
            data-group={i}
            tabIndex={-1}
            className="context-menu-item context-menu-group"
            onMouseEnter={() => hover(i)}
            onClick={() => setOpenGroup({ index: i, focus: true })}
          >
            {item.label}
            <ChevronIcon className="context-menu-chevron" />
          </button>
        ) : (
          <MenuRow
            key={i}
            item={item}
            onClose={onClose}
            onMouseEnter={() => hover(null)}
          />
        ),
      )}
      {group && isMenuGroup(group) && openGroup && (
        <SubMenu
          anchor={rowRefs.current.get(openGroup.index) ?? null}
          items={group.items}
          focus={openGroup.focus}
          onClose={onClose}
          onBack={() => {
            rowRefs.current.get(openGroup.index)?.focus();
            setOpenGroup(null);
          }}
          onEnter={holdHover}
        />
      )}
    </div>
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
    ref.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    return giveBack;
  }, [opener, ref, giveBack]);
  useEffect(() => {
    if (!open) giveBack();
  }, [open, giveBack]);
}

/** Which group's submenu is open, and the rows to place it by. Hovering a
 *  row opens its group, or closes the one open, after a beat: a pointer
 *  crossing to the submenu passes over other rows. */
function useSubmenu() {
  const [openGroup, setOpenGroup] = useState<{
    index: number;
    focus: boolean;
  } | null>(null);
  const rowRefs = useRef(new Map<number, HTMLButtonElement>());
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const hover = (index: number | null) => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(
      () => setOpenGroup(index === null ? null : { index, focus: false }),
      120,
    );
  };
  const holdHover = () => clearTimeout(hoverTimer.current);
  return { openGroup, setOpenGroup, rowRefs, hover, holdHover };
}

function MenuRow({
  item,
  onClose,
  onMouseEnter,
}: {
  item: ContextMenuItem;
  onClose: () => void;
  onMouseEnter?: () => void;
}) {
  return (
    <button
      role={item.checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={item.checked}
      tabIndex={-1}
      className={`context-menu-item ${item.danger ? "context-menu-item-danger" : ""}`}
      onMouseEnter={onMouseEnter}
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
  );
}

/** A group's items beside its row: to the right, or to the left where the
 *  window ends. Portalled, so the menu's own transform doesn't move it. */
function SubMenu({
  anchor,
  items,
  focus,
  onClose,
  onBack,
  onEnter,
}: {
  anchor: HTMLElement | null;
  items: (ContextMenuItem | "separator")[];
  focus: boolean;
  onClose: () => void;
  onBack: () => void;
  onEnter: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const row = anchor.getBoundingClientRect();
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    const left =
      row.right + width + margin <= window.innerWidth
        ? row.right - 4
        : Math.max(margin, row.left - width + 4);
    const top = Math.max(
      margin,
      Math.min(row.top - 4, window.innerHeight - height - margin),
    );
    setPos({ left, top });
  }, [anchor, items]);
  useEffect(() => {
    if (focus && pos)
      ref.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, [focus, pos]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const rows = Array.from(
      ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [],
    );
    const at = rows.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    if (e.key === "ArrowDown") next = rows[(at + 1) % rows.length];
    else if (e.key === "ArrowUp")
      next = rows[(at - 1 + rows.length) % rows.length];
    else if (e.key === "ArrowLeft" || e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onBack();
      return;
    } else if (e.key === "Tab") {
      e.preventDefault();
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
    next?.focus();
  }

  return createPortal(
    <div
      ref={ref}
      data-floating-menu
      className="context-menu context-submenu floating-surface"
      role="menu"
      style={pos ?? { left: -9999, top: -9999 }}
      onKeyDown={onKeyDown}
      onMouseEnter={onEnter}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={i} className="context-menu-separator" role="separator" />
        ) : (
          <MenuRow key={i} item={item} onClose={onClose} />
        ),
      )}
    </div>,
    document.body,
  );
}
