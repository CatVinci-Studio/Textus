import type { ShortcutAction } from "../../prefs/shortcut-defaults";
import { splitHere } from "./split-here";
import { openCommandPalette } from "../command-palette-entry";
import { TOGGLE_FIND_REPLACE_EVENT } from "../../utils/events";

/** What the window gives the actions to work with. */
export interface AppActionHandlers {
  onToggleSidebar: () => void;
  onToggleAgentPanel: () => void;
  onToggleSplitView: () => void;
  onToggleZenMode: () => void;
  onToggleTextusAi: () => void;
  onToggleTypewriter: () => void;
  toggleSourceMode: () => void;
}

/** One of the app's actions: the menu item that runs it (its id, the
 *  event "menu-<id>"), the shortcut Settings binds to it, and what it does. */
interface AppAction {
  menu: string;
  key: ShortcutAction;
  run: (h: AppActionHandlers) => void;
}

/**
 * The app's actions a menu item and a rebindable key both run, defined
 * once: the menu bridge listens for each item, the window's keys look each
 * combo up here, so a key and its item can't drift apart (a Mac's menu
 * takes the key first; elsewhere the page does).
 */
export const APP_ACTIONS: readonly AppAction[] = [
  {
    menu: "toggle-sidebar",
    key: "toggleSidebar",
    run: (h) => h.onToggleSidebar(),
  },
  {
    menu: "toggle-agent-panel",
    key: "toggleAgentPanel",
    run: (h) => h.onToggleAgentPanel(),
  },
  {
    menu: "toggle-split-view",
    key: "toggleSplitView",
    run: (h) => h.onToggleSplitView(),
  },
  {
    menu: "toggle-zen-mode",
    key: "toggleZenMode",
    run: (h) => h.onToggleZenMode(),
  },
  {
    menu: "toggle-textus-ai",
    key: "toggleTextusAi",
    run: (h) => h.onToggleTextusAi(),
  },
  {
    menu: "toggle-typewriter-mode",
    key: "toggleTypewriterMode",
    run: (h) => h.onToggleTypewriter(),
  },
  {
    menu: "toggle-source-mode",
    key: "toggleSourceMode",
    run: (h) => h.toggleSourceMode(),
  },
  { menu: "split-right", key: "splitEditor", run: () => splitHere("row") },
  {
    menu: "command-palette",
    key: "commandPalette",
    run: () => void openCommandPalette(),
  },
  {
    menu: "find-replace",
    key: "findReplace",
    run: () => window.dispatchEvent(new CustomEvent(TOGGLE_FIND_REPLACE_EVENT)),
  },
];

/** The action a combo runs under these shortcuts, if any. */
export function actionForCombo(
  combo: string,
  shortcuts: Readonly<Record<ShortcutAction, string>>,
): AppAction | undefined {
  return APP_ACTIONS.find((action) => shortcuts[action.key] === combo);
}
