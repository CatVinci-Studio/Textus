import { heldByPlugin } from "../plugins/contributions/editor-input";
import { useEffect } from "react";
import { cycleRegion, trackRegionFocus } from "./regions";
import { useSettings, type HeadingAction } from "../settings/SettingsContext";
import { adjacentTabId, type DocTab } from "../document/doc-tabs";
import { modIsMeta } from "../platform/os";
import { macTabStep } from "./fixed-shortcuts";
import {
  appDrawsWindowFrame,
  ownsMenuAccelerators,
} from "../platform/window-chrome";
import { runLocalMenuAction } from "./menu/app-menu-actions";
import { canOpenFolder } from "../platform/capabilities";
import { comboFromEvent } from "../utils/shortcuts";
import { menuIpc } from "../platform/ipc";
import { runMenuItemHere } from "../platform/menu-events";
import { commandForCombo } from "./commands";
import {
  TRIGGER_COMPLETION_EVENT,
  TRIGGER_GRAMMAR_CHECK_EVENT,
  TOGGLE_FLOATING_CHAT_EVENT,
  TOGGLE_FIND_REPLACE_EVENT,
  INSERT_BLOCK_EVENT,
} from "../utils/events";
import { closeSplit, splitEditor, splitLayout } from "./split/split-layout";
import { openCommandPalette } from "./command-palette";

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
const LINUX_MENU_ACCELERATORS: Record<string, string> = {
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
const WEBVIEW_FILE_COMMANDS: Record<string, string> = {
  "mod+t": "new-file",
  "mod+n": "new-window",
  "mod+shift+t": "reopen-closed-tab",
  "mod+o": "open-file",
  "mod+p": "export-pdf",
  "mod+,": "settings",
};

/** The window-wide keyboard shortcuts, fixed and configurable. */
export function useGlobalShortcuts(opts: {
  /** The window's tabs, read when a tab key is pressed. */
  tabsRef: { readonly current: readonly DocTab[] };
  activeTabId: string;
  setActiveTabId: (id: string) => void;
  saveTab: (tabId: string) => Promise<boolean>;
  requestCloseTab: (tabId: string) => void;
  toggleSourceMode: () => void;
  toggleSidebar: () => void;
  toggleAgentPanel: () => void;
  toggleSplitView: () => void;
  toggleZenMode: () => void;
  /** Opens the sidebar on its Files tab with the search box focused. */
  searchFiles: () => void;
  toggleTextusAi: () => void;
}): void {
  const {
    tabsRef,
    activeTabId,
    setActiveTabId,
    saveTab,
    requestCloseTab,
    toggleSourceMode,
    toggleSidebar,
    toggleAgentPanel,
    toggleSplitView,
    toggleZenMode,
    searchFiles,
    toggleTextusAi,
  } = opts;
  const { settings, setSettings } = useSettings();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
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
      const fileCommand = WEBVIEW_FILE_COMMANDS[combo];
      if (appDrawsWindowFrame && fileCommand) {
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
      if (combo === shortcuts.triggerCompletion) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(TRIGGER_COMPLETION_EVENT));
      } else if (combo === shortcuts.triggerGrammarCheck) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(TRIGGER_GRAMMAR_CHECK_EVENT));
      } else if (combo === shortcuts.toggleFloatingChat) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(TOGGLE_FLOATING_CHAT_EVENT));
      } else if (combo === shortcuts.toggleTextusAi) {
        e.preventDefault();
        toggleTextusAi();
      } else if (combo === shortcuts.findReplace) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(TOGGLE_FIND_REPLACE_EVENT));
      } else if (combo === shortcuts.toggleSidebar) {
        e.preventDefault();
        toggleSidebar();
      } else if (combo === shortcuts.toggleAgentPanel) {
        e.preventDefault();
        toggleAgentPanel();
      } else if (combo === shortcuts.toggleSplitView) {
        e.preventDefault();
        toggleSplitView();
      } else if (combo === shortcuts.toggleZenMode) {
        e.preventDefault();
        toggleZenMode();
      } else if (combo === shortcuts.commandPalette) {
        e.preventDefault();
        void openCommandPalette();
      } else if (combo === shortcuts.splitEditor) {
        // Split side by side, and the same keys go back to one.
        e.preventDefault();
        if (splitLayout()) closeSplit();
        else splitEditor("row");
      } else if (canOpenFolder && combo === shortcuts.searchFiles) {
        e.preventDefault();
        searchFiles();
      } else if (combo === shortcuts.toggleSourceMode) {
        e.preventDefault();
        toggleSourceMode();
      } else if (combo === shortcuts.toggleTypewriterMode) {
        e.preventDefault();
        setSettings({ typewriterMode: !settings.typewriterMode });
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
    toggleSourceMode,
    toggleSidebar,
    toggleAgentPanel,
    toggleSplitView,
    toggleZenMode,
    searchFiles,
    toggleTextusAi,
    setSettings,
  ]);
}
