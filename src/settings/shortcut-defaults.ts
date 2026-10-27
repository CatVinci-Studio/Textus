import { modIsMeta } from "../platform/os";
import { isRecord } from "./settings-sync";

/** The keyboard shortcuts Settings can rebind: their actions, the defaults
 *  per platform, and older saved shortcuts brought up to date. */

/// Keyboard-triggerable actions, each a normalized combo string ("" means
/// unbound).
export type ShortcutAction =
  | "triggerCompletion"
  | "triggerGrammarCheck"
  | "toggleFloatingChat"
  | "toggleTextusAi"
  | "toggleSidebar"
  | "toggleAgentPanel"
  | "toggleSplitView"
  | "toggleZenMode"
  | "splitEditor"
  | "commandPalette"
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

/** The shortcuts a new installation starts with, on this platform. The tab
 *  keys are Ctrl on a Mac too ("ctrl", not "mod"). Paragraph has none, as
 *  Ctrl/Cmd+0 is Actual Size. */
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
    splitEditor: "mod+alt+s",
    commandPalette: "mod+shift+p",
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

/** Stored shortcuts -> the bindings in force. A stored combo or "" is the
 *  user's choice; a missing one takes its default unless another stored
 *  action already has that key. */
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
