import { keptFromEngineOnly } from "../engine/controls/webview-guards";
import { heldByPlugin } from "../plugins/contributions/key-holder";
import { useEffect } from "react";
import { useLatest } from "../utils/hooks/useLatest";
import { cycleRegion, trackRegionFocus } from "./regions";
import { useSettings, type HeadingAction } from "../prefs/SettingsContext";
import { adjacentTabId, type DocTab } from "../document/doc-tabs";
import { modIsMeta } from "../platform/os";
import { macTabStep } from "../registry/fixed-shortcuts";
import {
  appDrawsWindowFrame,
  ownsMenuAccelerators,
} from "../platform/window-chrome";
import { runLocalMenuAction } from "./menu/app-menu-actions";
import { canOpenFolder } from "../platform/capabilities";
import { comboFromEvent } from "../utils/shortcuts";
import { menuIpc } from "../platform/ipc";
import { runMenuItemHere } from "../platform/menu-events";
import { commandForCombo } from "../registry/commands";
import {
  TRIGGER_COMPLETION_EVENT,
  TRIGGER_GRAMMAR_CHECK_EVENT,
  TOGGLE_FLOATING_CHAT_EVENT,
  SHOW_REPLACE_EVENT,
  FIND_NEXT_EVENT,
  INSERT_BLOCK_EVENT,
} from "../utils/events";
import { actionForCombo, type AppActionHandlers } from "./menu/app-actions";
import { pickIsland } from "../engine/layout/island-numbers";
import { isImeKeydown } from "../utils/ime";

/** The heading shortcuts, by the block kind they apply. */
const HEADING_KINDS: [HeadingAction, string][] = [
  ["setHeading1", "h1"],
  ["setHeading2", "h2"],
  ["setHeading3", "h3"],
  ["setHeading4", "h4"],
  ["setHeading5", "h5"],
  ["setHeading6", "h6"],
  ["setParagraph", "paragraph"],
];

/** The native menu's fixed accelerators, for Linux, where the hidden menu
 *  bar doesn't fire them. Keep in step with the Rust menu. */
export const LINUX_MENU_ACCELERATORS: Record<string, string> = {
  "mod+shift+s": "save-file-as",
  "mod+=": "zoom-in",
  "mod++": "zoom-in",
  "mod+shift++": "zoom-in",
  "mod+-": "zoom-out",
  "mod+0": "zoom-reset",
  "mod+shift+w": "close-window",
  "mod+q": "quit",
};

/** File commands routed through the backend where the app draws the window
 *  frame, so they work while focus is in the webview. */
export const WEBVIEW_FILE_COMMANDS: Record<string, string> = {
  "mod+n": "new-file",
  "mod+shift+n": "new-window",
  "mod+shift+t": "reopen-closed-tab",
  "mod+o": "open-file",
  "mod+p": "export-pdf",
  "mod+,": "settings",
};

/** New Tab's second key, which no menu item carries. */
const NEW_TAB_TOO = "mod+t";

/** Edit › Replace… and Find Next where the page sees keys first; a Mac's
 *  menu items take them before. */
export const FIND_KEYS: Record<string, string> = {
  "mod+alt+f": SHOW_REPLACE_EVENT,
  "mod+g": FIND_NEXT_EVENT,
};

/** The window-wide keyboard shortcuts, fixed and configurable. */
export function useGlobalShortcuts(opts: {
  /** The window's tabs, read when a tab key is pressed. */
  tabsRef: { readonly current: readonly DocTab[] };
  activeTabId: string;
  setActiveTabId: (id: string) => void;
  saveTab: (tabId: string) => Promise<boolean>;
  requestCloseTab: (tabId: string) => void;
  /** What the actions a menu item runs too work with (app-actions.ts). */
  actions: AppActionHandlers;
  /** Opens the sidebar on its Files tab with the search box focused. */
  searchFiles: () => void;
}): void {
  const {
    tabsRef,
    activeTabId,
    setActiveTabId,
    saveTab,
    requestCloseTab,
    actions,
    searchFiles,
  } = opts;
  const { settings } = useSettings();
  // Read when a key runs one: a new object each render would resubscribe.
  const actionsNow = useLatest(actions);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.defaultPrevented && !keptFromEngineOnly(e)) || isImeKeydown(e))
        return;
      if (heldByPlugin(e)) return;
      const combo = comboFromEvent(e);
      if (!combo) return;
      const { shortcuts } = settings;
      const heading = HEADING_KINDS.find(
        ([action]) => combo === shortcuts[action],
      );
      const target = e.target instanceof Element ? e.target : null;
      // Dialogs own their keyboard input. A heading key is swallowed there and
      // in text fields, or the macOS menu bar would change the document behind.
      if (target?.closest('[aria-modal="true"]')) {
        if (heading) e.preventDefault();
        return;
      }
      // With the islands' numbers up, ⌘1–⌘6 goes to an island, from a
      // text field too (the AI's): never a heading.
      const island = /^mod\+([1-6])$/.exec(combo);
      if (island && pickIsland(Number(island[1]))) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (heading && target?.closest("input, textarea")) {
        e.preventDefault();
        return;
      }
      if (combo === "mod+s") {
        e.preventDefault();
        void saveTab(activeTabId);
        return;
      }

      // The hidden native menu misses these while focus is in the webview, and
      // WebView2 would print the window itself on Ctrl+P.
      const fileCommand =
        combo === NEW_TAB_TOO ? "new-file" : WEBVIEW_FILE_COMMANDS[combo];
      if (fileCommand && (appDrawsWindowFrame || combo === NEW_TAB_TOO)) {
        e.preventDefault();
        void menuIpc.triggerMenuItem(fileCommand);
        return;
      }

      // Linux: the hidden GTK menu bar's accelerators don't fire.
      if (ownsMenuAccelerators) {
        const menuId = LINUX_MENU_ACCELERATORS[combo];
        if (menuId) {
          e.preventDefault();
          void runMenuItemHere(menuId);
          return;
        }
      }

      const findEvent = FIND_KEYS[combo];
      if (findEvent) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(findEvent));
        return;
      }

      if (combo === "mod+w") {
        e.preventDefault();
        requestCloseTab(activeTabId);
        return;
      }

      // F6 / Shift+F6: the keyboard's way out of the editor, where Tab indents.
      if (combo === "f6" || combo === "shift+f6") {
        e.preventDefault();
        e.stopPropagation();
        cycleRegion(combo === "f6" ? 1 : -1);
        return;
      }

      // The predefined native fullscreen item does nothing on Windows, so F11
      // is caught here; macOS keeps its own F11.
      if (appDrawsWindowFrame && combo === "f11") {
        e.preventDefault();
        runLocalMenuAction("fullscreen");
        return;
      }
      const tabStep =
        macTabStep(e, modIsMeta()) ??
        (combo === shortcuts.nextTab
          ? 1
          : combo === shortcuts.previousTab
            ? -1
            : null);
      if (tabStep !== null) {
        e.preventDefault();
        // The editor's Tab handler ignores Ctrl and would indent a code block.
        e.stopPropagation();
        const next = adjacentTabId(tabsRef.current, activeTabId, tabStep);
        if (next) setActiveTabId(next);
        return;
      }
      if (heading) {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent(INSERT_BLOCK_EVENT, { detail: heading[1] }),
        );
        return;
      }
      // An action a menu item runs too, as that item does.
      const action = actionForCombo(combo, shortcuts);
      if (action) {
        e.preventDefault();
        action.run(actionsNow.current);
        return;
      }
      if (combo === shortcuts.triggerCompletion) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(TRIGGER_COMPLETION_EVENT));
      } else if (combo === shortcuts.triggerGrammarCheck) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(TRIGGER_GRAMMAR_CHECK_EVENT));
      } else if (combo === shortcuts.toggleFloatingChat) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(TOGGLE_FLOATING_CHAT_EVENT));
      } else if (canOpenFolder && combo === shortcuts.searchFiles) {
        e.preventDefault();
        searchFiles();
      } else {
        // A command added from outside, on a combo the app hasn't taken.
        const command = commandForCombo(combo, settings.commandShortcuts);
        if (command) {
          e.preventDefault();
          command.run();
        }
      }
    }
    // Capture phase, so an editor plugin stopping the event can't eat Ctrl+F.
    window.addEventListener("keydown", onKeyDown, true);
    const untrack = trackRegionFocus();
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      untrack();
    };
  }, [
    saveTab,
    requestCloseTab,
    tabsRef,
    activeTabId,
    setActiveTabId,
    settings,
    actionsNow,
    searchFiles,
  ]);
}
