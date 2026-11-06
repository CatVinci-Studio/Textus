/** Keys macOS takes before any app sees them (Show/Hide Dock, Spotlight,
 *  app switching, Hide, Minimize, Quit, Force Quit, Lock Screen, emoji),
 *  as comboFromEvent names them. A plugin's or user's key here never fires. */
const MAC_SYSTEM_COMBOS = new Set([
  "mod+alt+d",
  "mod+space",
  "mod+tab",
  "mod+shift+tab",
  "mod+h",
  "mod+alt+h",
  "mod+m",
  "mod+q",
  "mod+`",
  "mod+ctrl+q",
  "mod+alt+escape",
  "mod+ctrl+space",
]);

export function isMacSystemCombo(combo: string): boolean {
  return MAC_SYSTEM_COMBOS.has(combo);
}
