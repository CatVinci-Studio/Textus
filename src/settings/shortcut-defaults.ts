import { modIsMeta } from "../platform/os";
import { isRecord } from "./settings-sync";

/**
 * The keyboard shortcuts Settings can rebind: their actions, the defaults
 * per platform, and older saved shortcuts brought up to date
 * (SettingsContext.tsx).
 */

/// Keyboard-triggerable actions. Each maps to a normalized combo string
/// (see ../utils/shortcuts) - empty string means "unbound".
export type ShortcutAction =
  | "triggerCompletion"
  | "triggerGrammarCheck"
  | "toggleFloatingChat"
  | "toggleTextusAi"
  | "toggleSidebar"
  | "toggleAgentPanel"
  | "toggleSplitView"
  | "toggleZenMode"
  | "toggleSourceMode"
  | "toggleTypewriterMode"
  | "findReplace"
  | "searchFiles"
  | "nextTab"
  | "previousTab"
  | HeadingAction;

/// The Format menu's block levels as shortcuts: Heading 1-6, and back to
/// body text.
export type HeadingAction =
  | "setHeading1"
  | "setHeading2"
  | "setHeading3"
  | "setHeading4"
  | "setHeading5"
  | "setHeading6"
  | "setParagraph";

export type Shortcuts = Record<ShortcutAction, string>;

/** The shortcuts a new installation starts with, on this platform. Only
 *  the tab keys differ: they are Ctrl+Tab on every platform, and Ctrl on a
 *  Mac is "ctrl", not "mod" (see ../utils/shortcuts). The heading levels
 *  are Typora's, Ctrl/Cmd+1..6; Paragraph has none, as Ctrl/Cmd+0 is
 *  Actual Size. */
export function defaultShortcuts(mac = modIsMeta()): Shortcuts {
  const ctrl = mac ? "ctrl" : "mod";
  return {
    triggerCompletion: "mod+shift+space",
    triggerGrammarCheck: "mod+shift+g",
    toggleFloatingChat: "mod+shift+k",
    toggleTextusAi: "",
    toggleSidebar: "mod+\\",
    toggleAgentPanel: "mod+shift+l",
    toggleSplitView: "mod+shift+e",
    toggleZenMode: "mod+shift+j",
    toggleSourceMode: "mod+/",
    toggleTypewriterMode: "",
    findReplace: "mod+f",
    searchFiles: "mod+shift+o",
    nextTab: `${ctrl}+tab`,
    previousTab: `${ctrl}+shift+tab`,
    setHeading1: "mod+1",
    setHeading2: "mod+2",
    setHeading3: "mod+3",
    setHeading4: "mod+4",
    setHeading5: "mod+5",
    setHeading6: "mod+6",
    setParagraph: "",
  };
}

export const DEFAULT_SHORTCUTS: Shortcuts = defaultShortcuts();

/**
 * Stored shortcuts -> the bindings in force. An action stored with a combo,
 * or with "", keeps it: that is the user's own choice. An action not stored
 * as a string (a binding newer than the file, a hand edit) takes its
 * default - but only while no stored action has that combo already: two
 * actions on one key would leave one of them dead.
 */
export function storedShortcuts(
  stored: unknown,
  defaults: Shortcuts = DEFAULT_SHORTCUTS,
): Shortcuts {
  const saved = (isRecord(stored) ? stored : {}) as Partial<Shortcuts>;
  const taken = new Set(Object.values(saved).filter(Boolean));
  // Spread, to keep the actions of a newer build this one doesn't know.
  const result = { ...defaults, ...saved } as Shortcuts;
  for (const action of Object.keys(defaults) as ShortcutAction[]) {
    if (typeof saved[action] !== "string")
      result[action] = taken.has(defaults[action]) ? "" : defaults[action];
  }
  return result;
}
