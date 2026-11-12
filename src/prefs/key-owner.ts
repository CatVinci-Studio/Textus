import { fill } from "../i18n/fill";
import type { Strings } from "../i18n/strings";
import type {
  HeadingAction,
  ShortcutAction,
  Shortcuts,
} from "./SettingsContext";
import type { FixedShortcutGroup } from "../registry/fixed-shortcuts";
import { isMacSystemCombo } from "../utils/system-keys";

/** The heading shortcuts' names: the Format menu's own, and Paragraph. */
export function headingLabels(t: Strings): Record<HeadingAction, string> {
  const level = (n: number) => fill(t.menuHeadingTemplate, { n: String(n) });
  return {
    setHeading1: level(1),
    setHeading2: level(2),
    setHeading3: level(3),
    setHeading4: level(4),
    setHeading5: level(5),
    setHeading6: level(6),
    setParagraph: t.shortcutParagraph,
  };
}

/** A menu item's name as an action's: without the "…" of one that asks
 *  for more. The shortcuts use the menu's names, so the two never differ. */
const plain = (label: string) => label.replace(/…$/, "");

/** Every action's name: its row in Settings, a conflict's message. */
export function actionLabels(t: Strings): Record<ShortcutAction, string> {
  return {
    triggerCompletion: t.shortcutTriggerCompletion,
    triggerGrammarCheck: t.shortcutTriggerGrammarCheck,
    toggleFloatingChat: t.shortcutToggleFloatingChat,
    toggleTextusAi: t.shortcutToggleTextusAi,
    findReplace: plain(t.menuFindReplace),
    toggleSidebar: t.menuToggleSidebar,
    toggleAgentPanel: t.menuToggleAgentPanel,
    toggleSplitView: t.menuToggleSplitView,
    toggleZenMode: t.menuToggleZenMode,
    splitEditor: t.menuSplitRight,
    commandPalette: t.shortcutCommandPalette,
    toggleSourceMode: t.menuToggleSourceMode,
    toggleTypewriterMode: t.menuToggleTypewriterMode,
    searchFiles: t.shortcutSearchFiles,
    nextTab: t.shortcutNextTab,
    previousTab: t.shortcutPreviousTab,
    ...headingLabels(t),
  };
}

interface KeyOwners {
  t: Strings;
  /** The fixed shortcuts, the editor's own keys among them. */
  fixed: FixedShortcutGroup[];
  shortcuts: Shortcuts;
  /** Apple's keyboard: the system's keys come first. */
  mac: boolean;
  /** The action whose key this is, which doesn't own it against itself. */
  self?: ShortcutAction;
  /** Commands' keys now, by name. */
  others?: { label: string; combo: string }[];
}

/** Who has `combo` already, by name: a fixed or editor key, the system, an
 *  app action or another command. One check for Settings and for plugins. */
export function keyOwner(combo: string, owners: KeyOwners): string | undefined {
  const { t, fixed, shortcuts, mac, self, others = [] } = owners;
  const labels = actionLabels(t);
  return (
    fixed
      .flatMap((group) => group.items)
      .find((item) => item.combos.includes(combo))?.label ??
    (mac && isMacSystemCombo(combo) ? "macOS" : undefined) ??
    (Object.keys(shortcuts) as ShortcutAction[])
      .filter((action) => action !== self && shortcuts[action] === combo)
      .map((action) => labels[action])[0] ??
    others.find((other) => other.combo === combo)?.label
  );
}
