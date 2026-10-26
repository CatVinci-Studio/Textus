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

/** The heading shortcuts, by the Format menu's block kind they apply
 *  (INSERT_BLOCK_EVENT). */
const HEADING_KINDS: [HeadingAction, string][] = [
  ["setHeading1", "h1"],
  ["setHeading2", "h2"],
  ["setHeading3", "h3"],
  ["setHeading4", "h4"],
  ["setHeading5", "h5"],
  ["setHeading6", "h6"],
  ["setParagraph", "paragraph"],
];

/** The native menu's fixed accelerators (src-tauri/src/menu.rs), for
 *  Linux, where the hidden menu bar no longer fires them. Save, Close Tab,
 *  New and Open are handled below on every platform that needs them. */
const LINUX_MENU_ACCELERATORS: Record<string, string> = {
  "mod+,": "settings",
  "mod+shift+s": "save-file-as",
  "mod+=": "zoom-in",
  "mod++": "zoom-in",
  "mod+shift++": "zoom-in",
  "mod+-": "zoom-out",
  "mod+0": "zoom-reset",
  "mod+shift+n": "new-window",
  "mod+shift+w": "close-window",
  "mod+q": "quit",
};

/** File commands routed through the backend where the app draws the window
 *  frame (Windows, Linux), so they reach the menu dispatch while focus is
 *  inside the webview - see the keydown handler below. */
const WEBVIEW_FILE_COMMANDS: Record<string, string> = {
  "mod+n": "new-file",
  "mod+o": "open-file",
  "mod+p": "export-pdf",
};

/**
 * The window-wide keyboard shortcuts: the fixed OS-convention ones (save,
 * close tab, fullscreen, and the native menu's accelerators where that menu
 * can't fire them) plus the configurable settings.shortcuts entries.
 * Pulled out of App.tsx; every action it triggers is handed in from there.
 */
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
  /** Turns Textus AI on or off (ai/TextusAiSwitch.tsx's useTextusAi). */
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
      // Dialogs (including shortcut recording) own their keyboard input.
      // A heading key is swallowed there, and in a text field outside the
      // document (the AI panel, Quick Ask, a search box): it means nothing
      // in either, and left alone it would reach the macOS menu bar's own
      // key for the level (menu.rs), which changes the document behind.
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

      // Windows has no visible native menu bar. Its menu is kept internally
      // for most accelerators, but Open/New are handled here so they remain
      // reliable while focus is inside the webview/editor. The backend still
      // owns their behaviour (including tab-vs-window mode), exactly as if
      // the corresponding menu item had been clicked. Ctrl+P too: left to
      // the webview, WebView2 printed the app window itself, with the
      // browser's date/title header and tauri.localhost footer (#68).
      const fileCommand = WEBVIEW_FILE_COMMANDS[combo];
      if (appDrawsWindowFrame && fileCommand) {
        e.preventDefault();
        void menuIpc.triggerMenuItem(fileCommand);
        return;
      }

      // Linux: the hidden GTK menu bar's accelerators no longer fire (see
      // ownsMenuAccelerators), so its fixed shortcuts are routed through the
      // same dispatch a menu click uses.
      if (ownsMenuAccelerators) {
        const menuId = LINUX_MENU_ACCELERATORS[combo];
        if (menuId) {
          e.preventDefault();
          void runMenuItemHere(menuId);
          return;
        }
      }

      // Fixed OS-convention shortcut like Cmd+S above, not a configurable
      // settings.shortcuts entry - it mirrors the File > Close Tab menu
      // accelerator. (Close Window keeps its native Cmd+Shift+W.)
      if (combo === "mod+w") {
        e.preventDefault();
        requestCloseTab(activeTabId);
        return;
      }

      // F6 / Shift+F6: the next or previous region (app/regions.ts) - the
      // keyboard's way out of the editor, where Tab indents. Not in a
      // dialog, which keeps the focus (the check above).
      if (combo === "f6" || combo === "shift+f6") {
        e.preventDefault();
        e.stopPropagation();
        cycleRegion(combo === "f6" ? 1 : -1);
        return;
      }

      // F11 is THE fullscreen key on Windows, and the only way to reach
      // fullscreen where the app draws its own frame: macOS has the native
      // View > Enter Full Screen item (Ctrl+Cmd+F), but muda's predefined
      // fullscreen item does nothing on Windows, so there is no native
      // accelerator to register and it has to be caught here. Gated on the
      // same flag the app-drawn menu is, so macOS's F11 keeps whatever the
      // system does with it.
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
        // Kept from the editor too: its Tab handler (tab-extend-plugin)
        // doesn't look at Ctrl, and would indent the code block left behind.
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
        // A command added from outside (commands.ts), on a combo none of
        // the app's own has taken.
        const command = commandForCombo(combo);
        if (command) {
          e.preventDefault();
          command.run();
        }
      }
    }
    // Capture before the editor's keymaps: shortcuts such as Ctrl+F must not
    // disappear merely because an editor plugin stops the bubbling event.
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
