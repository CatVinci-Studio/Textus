import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "../settings/SettingsContext";
import { menuIpc } from "../platform/ipc";
import { formatCombo } from "../utils/shortcuts";
import { useViewportClamp } from "../utils/hooks/useViewportClamp";
import { runLocalMenuAction } from "./app-menu-actions";
import { emitMenuEvent, runMenuItemHere } from "../platform/menu-events";
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
import { getCurrentWindow } from "@tauri-apps/api/window";
import { canToggleFullscreen, hasAppMenu } from "../platform/capabilities";
import { CheckIcon, ChevronIcon } from "../ui/icons";
import { usePresenceProps } from "../ui/usePresence";
import { usePhoneLayout } from "../ui/usePhoneLayout";
import "./app-menu.css";
import { usePluginMenuEntries } from "../plugins/usePluginMenu";

/**
 * The app-drawn menu, opened from the title row's hamburger - or one of
 * its lists, from the menu bar (MenuBar.tsx).
 *
 * Only ever mounted where the OS frame is gone and the native menu bar went
 * with it (Windows - see platform/window-chrome.ts). It replaces a `popup_menu_at`
 * of the real `Menu`, which worked but was the raw Win32 popup: the system's
 * grey, in the system's font, and - the reason this exists - labelled from
 * Rust string literals that never followed the language picked in Settings.
 * Drawn here it is the app's own surface, and every label comes from the
 * same i18n table the rest of the UI reads.
 *
 * The native menu stays installed and merely hidden, because that is what
 * keeps its accelerators alive (see hide_native_menu_bar in lib.rs); this
 * menu addresses the same items by id through `trigger_menu_item`.
 */

interface AppMenuProps {
  /** Viewport position of the button's bottom-left corner. Dismissal and
   *  focus restoration belong to the button (see AppMenuButton), which is
   *  why this takes an `onClose` rather than owning one. */
  x: number;
  y: number;
  onClose: () => void;
  /** Which view modes are on, for their check marks. */
  checks?: MenuChecks;
  /** One of the menu bar's titles (menuBarSections) - its list alone,
   *  opened from the bar (MenuBar.tsx); the whole menu when left out. */
  section?: number;
}

export function AppMenu({ x, y, onClose, checks, section }: AppMenuProps) {
  const { t, settings } = useSettings();
  const pluginEntries = usePluginMenuEntries(settings.language);
  const ref = useRef<HTMLDivElement>(null);
  const pos = useViewportClamp(ref, x, y);
  const phone = usePhoneLayout();
  // It grows out of the button (top left) and, closed, fades where it is.
  const presence = usePresenceProps(ref);

  const { recents, fullscreen } = useMenuOpening();

  const menu = hasAppMenu
    ? buildAppMenu(
        t,
        settings.shortcuts,
        recents,
        { ...checks, fullscreen },
        pluginEntries,
      )
    : buildMobileMenu(t, checks);
  const items =
    section === undefined
      ? menu
      : (menuBarSections(menu)[section]?.items ?? []);

  // On <body>, not inside the title row that opens it: the row is a fixed
  // layer of its own (z-index 45), so a menu inside it could never rise
  // above the find bar (300) however high its own z-index was set - the
  // find bar covered its first rows on the phone and on Windows.
  return createPortal(
    <div {...presence} className="app-menu" style={pos} data-floating-menu="">
      <MenuList
        items={items}
        onDismiss={onClose}
        // The arrow keys need a row to start from; a finger doesn't, and on
        // a phone the first row would only sit there looking selected.
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

/** What the menu reads as it opens: the recent files and folders, and
 *  whether the window is in full screen. */
function useMenuOpening() {
  const [recents, setRecents] = useState<RecentLists>(NO_RECENTS);
  const [fullscreen, setFullscreen] = useState(false);

  // Read once per opening, not per render: Open Recent must show what the
  // list holds NOW (including a file opened since the menu was last up), and
  // nothing about it changes while the menu is on screen.
  useEffect(() => {
    if (!hasAppMenu) return;
    let alive = true;
    void Promise.all([menuIpc.listRecentFiles(), menuIpc.listRecentFolders()])
      .then(([files, folders]) => {
        // The dev shim answers every command with null rather than
        // rejecting, so this cannot lean on the catch below.
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

  // Full Screen is the window's, not the app's: asked as the menu opens.
  useEffect(() => {
    if (!hasAppMenu || !canToggleFullscreen) return;
    let alive = true;
    try {
      void getCurrentWindow()
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
  // A flyout slides out of its row - unless another one was showing a
  // moment ago: running the pointer from one submenu to the next swaps
  // them at once, as macOS does.
  const lastFlyout = useRef(-Infinity);
  const [instantFlyout, setInstantFlyout] = useState(false);
  const showFlyout = (index: number | null) => {
    if (index === openIndex) return;
    const now = clock();
    if (openIndex !== null) lastFlyout.current = now;
    setInstantFlyout(index !== null && now - lastFlyout.current < 400);
    setOpenIndex(index);
  };

  useEffect(() => {
    if (!autoFocus) return;
    // A flyout is painted hidden for a frame while it measures where it
    // fits (Flyout below), and a hidden element can't take focus - focusing
    // at mount left the keyboard on the parent list, so ArrowRight opened a
    // submenu that the arrow keys then walked past.
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
            // Hovering a row with no submenu closes the one that is open:
            // otherwise a flyout opened on the way down the list stays
            // hanging over the rows below it.
            onHover={() => showFlyout(item.submenu ? i : null)}
            onOpenSubmenu={() => showFlyout(i)}
            onCloseSubmenu={() => showFlyout(null)}
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
  onOpenSubmenu,
  onCloseSubmenu,
  onDismiss,
}: {
  item: MenuEntry;
  /** Keep the trailing check column, marked or empty (see MenuList). */
  checkColumn: boolean;
  open: boolean;
  /** Its flyout appears without sliding (see MenuList). */
  instantFlyout: boolean;
  onHover: () => void;
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
    if ("native" in item.action && !hasAppMenu) {
      emitMenuEvent(item.action.native);
    } else if ("native" in item.action) {
      void runMenuItemHere(item.action.native).catch(() => {
        // A failed menu command is the backend's to report; swallowing it
        // here only leaves a dead menu on screen.
      });
    } else {
      runLocalMenuAction(item.action.local);
    }
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
          // Clear the keyboard flag first: it survives the flyout being
          // unmounted, and without this a later hover over the same row
          // would open its submenu AND pull focus into it.
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
        <Flyout anchor={rowRef} instant={instantFlyout}>
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

/**
 * A submenu panel, placed beside its row and nudged back inside the window
 * when it would hang off an edge. Measured after mount rather than guessed
 * from the item count: Open Recent's height depends on how many files there
 * are, and the export list is long enough to reach the bottom of a small
 * window.
 */
function Flyout({
  anchor,
  instant,
  children,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>;
  instant: boolean;
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
      // Painted only once measured, so the first frame is never a panel
      // sitting at the wrong corner of the window.
      style={pos ?? { visibility: "hidden", left: 0, top: 0 }}
    >
      {children}
    </div>
  );
}
