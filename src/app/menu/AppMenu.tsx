import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "../../prefs/SettingsContext";
import { menuIpc } from "../../platform/ipc";
import { formatCombo } from "../../utils/shortcuts";
import { useViewportClamp } from "../../utils/hooks/useViewportClamp";
import { runMenuAction } from "./app-menu-actions";
import {
  buildAppMenu,
  buildMobileMenu,
  menuBarSections,
  NO_RECENTS,
  type RecentLists,
  type MenuChecks,
  type MenuEntry,
  type MenuNode,
} from "./app-menu-model";
import { thisWindow } from "../../platform/this-window";
import { canToggleFullscreen, hasAppMenu } from "../../platform/capabilities";
import { useMenuAim } from "../../ui/menu-aim";
import { CheckIcon, ChevronIcon } from "../../ui/icons";
import { usePresenceProps } from "../../ui/usePresence";
import { usePhoneLayout } from "../../ui/usePhoneLayout";
import "./app-menu.css";
import { usePluginMenuEntries } from "../../plugins/contributions/usePluginMenu";
import { trackingShown } from "../../ai/margin/track-changes-state";

/**
 * The app-drawn menu, where the native menu bar is hidden (Windows), with
 * labels from the app's i18n table. It fires the hidden native items by id.
 */

interface AppMenuProps {
  /** Viewport position of the button's bottom-left corner; the button owns
   *  dismissal and focus restoration. */
  x: number;
  y: number;
  onClose: () => void;
  /** Which view modes are on, for their check marks. */
  checks?: MenuChecks;
  /** One menu bar section's list alone; the whole menu when left out. */
  section?: number;
}

export function AppMenu({ x, y, onClose, checks, section }: AppMenuProps) {
  const { t, settings } = useSettings();
  const pluginEntries = usePluginMenuEntries(settings.language);
  const ref = useRef<HTMLDivElement>(null);
  const pos = useViewportClamp(ref, x, y);
  const phone = usePhoneLayout();
  const presence = usePresenceProps(ref);

  const { recents, fullscreen } = useMenuOpening();

  const menu = hasAppMenu
    ? buildAppMenu(
        t,
        settings.shortcuts,
        recents,
        { ...checks, fullscreen, trackChanges: trackingShown() },
        pluginEntries,
      )
    : buildMobileMenu(t, checks);
  const items =
    section === undefined
      ? menu
      : (menuBarSections(menu)[section]?.items ?? []);

  // On <body>: inside the title row's own stacking layer it could never rise
  // above the find bar.
  return createPortal(
    <div {...presence} className="app-menu" style={pos} data-floating-menu="">
      <MenuList
        items={items}
        onDismiss={onClose}
        // On a phone a focused first row would only look selected.
        autoFocus={!phone}
      />
    </div>,
    document.body,
  );
}

/** For the flyouts' timing, read in event handlers only. */
const clock = () => performance.now();

/** Focuses the nth enabled item of a list, wrapping at both ends. */
function focusItem(list: HTMLElement | null, index: number) {
  if (!list) return;
  // `:scope >` keeps an open flyout's items out of the parent's arrow-key
  // walk - they are DOM children of the row they hang off.
  const rows = Array.from(
    list.querySelectorAll<HTMLButtonElement>(
      ":scope > .app-menu-row > .app-menu-item:not(:disabled)",
    ),
  );
  if (rows.length === 0) return;
  rows[(index + rows.length) % rows.length]?.focus();
}

/** What the menu reads once as it opens: the recent files and folders, and
 *  whether the window is in full screen. */
function useMenuOpening() {
  const [recents, setRecents] = useState<RecentLists>(NO_RECENTS);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!hasAppMenu) return;
    let alive = true;
    void Promise.all([menuIpc.listRecentFiles(), menuIpc.listRecentFolders()])
      .then(([files, folders]) => {
        // The dev shim answers null rather than rejecting.
        if (alive)
          setRecents({
            files: Array.isArray(files) ? files : [],
            folders: Array.isArray(folders) ? folders : [],
          });
      })
      .catch(() => {
        // No backend at all: Open Recent shows its empty state.
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!hasAppMenu || !canToggleFullscreen) return;
    let alive = true;
    try {
      void thisWindow()
        .isFullscreen()
        .then((on) => {
          if (alive) setFullscreen(on === true);
        })
        .catch(() => {});
    } catch {
      // No window to ask (a test, the dev shim): Full Screen shows off.
    }
    return () => {
      alive = false;
    };
  }, []);

  return { recents, fullscreen };
}

function MenuList({
  items,
  onDismiss,
  onLeave,
  autoFocus = false,
}: {
  items: MenuNode[];
  /** Close the whole menu - an item was chosen, or Escape. */
  onDismiss: () => void;
  /** Close just this submenu and hand focus back to the row it hangs off. */
  onLeave?: () => void;
  autoFocus?: boolean;
}) {
  // One open flyout per level, by row index.
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Moving from one submenu straight to the next swaps them without the
  // slide, as macOS does.
  const lastFlyout = useRef(-Infinity);
  const [instantFlyout, setInstantFlyout] = useState(false);
  const showFlyout = (index: number | null) => {
    if (index === openIndex) return;
    const now = clock();
    if (openIndex !== null) lastFlyout.current = now;
    setInstantFlyout(index !== null && now - lastFlyout.current < 400);
    setOpenIndex(index);
  };
  // A pointer on its way to the open flyout leaves it open (menu-aim.ts).
  const aim = useMenuAim<number>(
    showFlyout,
    () => listRef.current,
    () =>
      listRef.current?.querySelector<HTMLElement>(
        ":scope > .app-menu-row > .app-menu-flyout",
      ) ?? null,
  );

  useEffect(() => {
    if (!autoFocus) return;
    // A flyout is hidden for a frame while it measures, and a hidden element
    // can't take focus, so wait two frames.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => focusItem(listRef.current, 0));
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const rows = listRef.current?.querySelectorAll<HTMLButtonElement>(
      ":scope > .app-menu-row > .app-menu-item:not(:disabled)",
    );
    const current = Array.from(rows ?? []).indexOf(
      document.activeElement as HTMLButtonElement,
    );
    // Every branch stops propagation: with a flyout open both lists are on
    // the same bubble path, and the parent would move its own focus too.
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      focusItem(listRef.current, current + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "ArrowLeft" && onLeave) {
      e.preventDefault();
      e.stopPropagation();
      onLeave();
    }
  }

  // A list with an on/off item gives every row the trailing check column,
  // so the shortcut hints stay in one line whether a mark is showing or not.
  const checkColumn = items.some(
    (item) => item !== "separator" && item.checked !== undefined,
  );

  return (
    <div
      ref={listRef}
      className="app-menu-list floating-surface"
      role="menu"
      onKeyDown={onKeyDown}
      onMouseMove={aim.move}
    >
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={i} className="app-menu-separator" role="separator" />
        ) : (
          <MenuRow
            key={i}
            item={item}
            checkColumn={checkColumn}
            open={openIndex === i}
            instantFlyout={instantFlyout}
            // Hovering a row with no submenu closes the open one.
            onHover={() => aim.hover(item.submenu ? i : null)}
            onEnterFlyout={aim.hold}
            // The keyboard's choice; a hover still pending doesn't undo it.
            onOpenSubmenu={() => {
              aim.hold();
              showFlyout(i);
            }}
            onCloseSubmenu={() => {
              aim.hold();
              showFlyout(null);
            }}
            onDismiss={onDismiss}
          />
        ),
      )}
    </div>
  );
}

function MenuRow({
  item,
  checkColumn,
  open,
  instantFlyout,
  onHover,
  onEnterFlyout,
  onOpenSubmenu,
  onCloseSubmenu,
  onDismiss,
}: {
  item: MenuEntry;
  /** Keep the trailing check column, marked or empty. */
  checkColumn: boolean;
  open: boolean;
  /** Its flyout appears without sliding. */
  instantFlyout: boolean;
  onHover: () => void;
  /** The pointer reached its flyout. */
  onEnterFlyout: () => void;
  onOpenSubmenu: () => void;
  onCloseSubmenu: () => void;
  onDismiss: () => void;
}) {
  const rowRef = useRef<HTMLButtonElement>(null);
  const hasSubmenu = !!item.submenu;
  // Set only when the submenu was opened from the keyboard, so a mouse
  // hover doesn't yank focus off whatever the user was typing into.
  const [focusSubmenu, setFocusSubmenu] = useState(false);

  function activate() {
    if (item.disabled) return;
    if (hasSubmenu) {
      setFocusSubmenu(true);
      onOpenSubmenu();
      return;
    }
    if (!item.action) return;
    runMenuAction(item.action);
    onDismiss();
  }

  return (
    // role="none" because a menu's children must be menuitems; this box
    // exists only to anchor the flyout.
    <div className="app-menu-row" role="none">
      <button
        ref={rowRef}
        type="button"
        role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
        aria-checked={item.checked}
        className="app-menu-item"
        title={item.title}
        disabled={item.disabled}
        aria-haspopup={hasSubmenu ? "menu" : undefined}
        aria-expanded={hasSubmenu ? open : undefined}
        onMouseEnter={() => {
          // The keyboard flag outlives the flyout; a later hover would
          // otherwise pull focus into the submenu.
          setFocusSubmenu(false);
          onHover();
        }}
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" && hasSubmenu) {
            e.preventDefault();
            e.stopPropagation();
            setFocusSubmenu(true);
            onOpenSubmenu();
          }
        }}
      >
        <span className="app-menu-label">{item.label}</span>
        {item.accel && (
          <span className="app-menu-accel">{formatCombo(item.accel)}</span>
        )}
        {/* One mark for every on/off item, always at the trailing edge. */}
        {checkColumn && !hasSubmenu && (
          <span className="app-menu-check" aria-hidden="true">
            {item.checked && <CheckIcon />}
          </span>
        )}
        {hasSubmenu && <ChevronIcon className="app-menu-chevron" />}
      </button>
      {hasSubmenu && open && (
        <Flyout
          anchor={rowRef}
          instant={instantFlyout}
          onMouseEnter={onEnterFlyout}
        >
          <MenuList
            items={item.submenu ?? []}
            onDismiss={onDismiss}
            autoFocus={focusSubmenu}
            onLeave={() => {
              setFocusSubmenu(false);
              onCloseSubmenu();
              rowRef.current?.focus();
            }}
          />
        </Flyout>
      )}
    </div>
  );
}

/** A submenu panel beside its row, measured after mount and nudged back
 *  inside the window when it would hang off an edge. */
function Flyout({
  anchor,
  instant,
  onMouseEnter,
  children,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>;
  instant: boolean;
  onMouseEnter: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const panel = ref.current;
    const row = anchor.current;
    if (!panel || !row) return;
    const rowBox = row.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    const margin = 6;

    let left = rowBox.right + 2;
    if (left + panelBox.width > window.innerWidth - margin) {
      left = Math.max(margin, rowBox.left - panelBox.width - 2);
    }
    let top = rowBox.top - 5;
    if (top + panelBox.height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - margin - panelBox.height);
    }
    setPos({ left, top });
  }, [anchor, children]);

  return (
    <div
      ref={ref}
      className={`app-menu-flyout${instant ? " app-menu-flyout-instant" : ""}`}
      onMouseEnter={onMouseEnter}
      // Painted only once measured.
      style={pos ?? { visibility: "hidden", left: 0, top: 0 }}
    >
      {children}
    </div>
  );
}
