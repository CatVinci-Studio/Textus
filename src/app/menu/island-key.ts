import type { HeadingAction, Shortcuts } from "../../prefs/SettingsContext";

/**
 * The number key a heading's menu item was reached by: for block `kind`
 * ("h1"…"h6") whose shortcut is ⌘ and a digit 1–6, that digit; null for
 * any other block, or a heading on other keys.
 */
export function islandKeyOf(kind: string, shortcuts: Shortcuts): number | null {
  const level = /^h([1-6])$/.exec(kind)?.[1];
  if (!level) return null;
  const combo = shortcuts[`setHeading${level}` as HeadingAction];
  const digit = /^mod\+([1-6])$/.exec(combo ?? "")?.[1];
  return digit ? Number(digit) : null;
}
