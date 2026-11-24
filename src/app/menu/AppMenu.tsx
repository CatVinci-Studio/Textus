import { useEffect, useState } from "react";
import { useSettings } from "../../prefs/SettingsContext";
import { readRecents } from "./recents";
import { formatCombo } from "../../utils/shortcuts";
import { opensField, runMenuAction } from "./app-menu-actions";
import { holdKeyboard } from "../../engine/controls/hold-keyboard";
import { isMobileApp } from "../../platform/capabilities";
import {
  buildAppMenu,
  buildMobileMenu,
  menuBarSections,
  NO_RECENTS,
  type RecentLists,
  type MenuChecks,
  type MenuEntry,
  type MenuNode,
} from "../../registry/menu/app-menu-model";
import { thisWindow } from "../../platform/this-window";
import { windowIpc } from "../../platform/ipc";
import { canToggleFullscreen, hasAppMenu } from "../../platform/capabilities";
import { usePhoneLayout } from "../../engine/controls/usePhoneLayout";
import {
  ContextMenu,
  type ContextMenuEntry,
} from "../../engine/controls/ContextMenu";
import { usePluginMenuEntries } from "../../plugins/contributions/usePluginMenu";
import { trackingShown } from "../../ai/margin/track-changes-state";

/**
 * The app-drawn menu, where the native menu bar is hidden (Windows, Linux,
 * the phone), with labels from the app's i18n table: the menu model as the
 * shared ContextMenu's items. It fires the hidden native items by id.
 */

interface AppMenuProps {
  /** Viewport position of the button's bottom-left corner; the button owns
   *  dismissal and focus restoration. */
  x: number;
  y: number;
  onClose: () => void;
  /** The bar or button it hangs from: a press there is the opener's. */
  anchor?: HTMLElement | null;
  /** Which view modes are on, for their check marks. */
  checks?: MenuChecks;
  /** One menu bar section's list alone; the whole menu when left out. */
  section?: number;
}

export function AppMenu({
  x,
  y,
  onClose,
  anchor,
  checks,
  section,
}: AppMenuProps) {
  const { t, settings } = useSettings();
  const pluginEntries = usePluginMenuEntries(settings.language);
  const phone = usePhoneLayout();
  const { recents, fullscreen } = useMenuOpening();

  // A tablet's layout is the desktop's, and so is its menu.
  const menu = !phone
    ? buildAppMenu(
        t,
        settings.shortcuts,
        recents,
        { ...checks, fullscreen, trackChanges: trackingShown() },
        pluginEntries,
      )
    : buildMobileMenu(t, checks, pluginEntries);
  const nodes =
    section === undefined
      ? menu
      : (menuBarSections(menu)[section]?.items ?? []);

  return (
    <ContextMenu
      x={x}
      y={y}
      items={nodes.map((node) => entryOf(node, onClose))}
      onClose={onClose}
      anchor={anchor}
      // On a phone a focused first row would only look selected.
      keyboard={!phone}
    />
  );
}

/** A model row as a menu row: closed first, so the focus is back where it
 *  was (source mode, the AI's box) for Undo, Redo and Select All. */
function entryOf(node: MenuNode, dismiss: () => void): ContextMenuEntry {
  if (node === "separator") return node;
  if (node.submenu)
    return {
      label: node.label,
      items: node.submenu.map((n) => entryOf(n, dismiss)),
      disabled: node.disabled,
    };
  const action = node.action;
  return {
    label: node.label,
    hint: node.title,
    accel: node.accel ? formatCombo(node.accel) : undefined,
    checked: node.checked,
    toggle: true,
    disabled: node.disabled,
    onSelect: (e) => {
      if (!action) return;
      dismiss();
      const folder = recentFolderOf(action);
      // ⌘/Ctrl-click: the folder in a window of its own.
      if (folder && (e?.metaKey || e?.ctrlKey))
        void windowIpc.openFolderInNewWindow(folder);
      else {
        // Find opens its field after this tap: the keyboard is asked for now.
        if (isMobileApp && opensField(action)) holdKeyboard();
        runMenuAction(action);
      }
    },
  };
}

/** The folder a recent-folder entry opens, if it is one. */
function recentFolderOf(action: MenuEntry["action"]): string | null {
  const id = action && "native" in action ? action.native : "";
  return id.startsWith("recent-folder:") ? id.slice(14) : null;
}

/** What the menu reads once as it opens: the recent files and folders, and
 *  whether the window is in full screen. */
function useMenuOpening() {
  const [recents, setRecents] = useState<RecentLists>(NO_RECENTS);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!hasAppMenu) return;
    let alive = true;
    void readRecents()
      .then((found) => {
        if (alive) setRecents(found);
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
