/// Key-combo helpers. Combos are normalized strings like "mod+shift+g", where
/// "mod" is Cmd on Apple platforms and Ctrl elsewhere.
import { modIsMeta } from "../platform/os";
const MODIFIER_KEYS = new Set(["control", "meta", "alt", "shift", "altgraph"]);

/// Builds a normalized combo string from a KeyboardEvent. Returns null while
/// only modifier keys are held (not a complete, bindable combo yet).
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (e.isComposing || e.keyCode === 229 || e.getModifierState("AltGraph"))
    return null;
  const key = e.key.toLowerCase();
  if (MODIFIER_KEYS.has(key)) return null;

  const parts: string[] = [];
  const mac = modIsMeta();
  if (mac ? e.metaKey : e.ctrlKey) parts.push("mod");
  if (mac && e.ctrlKey) parts.push("ctrl");
  if (!mac && e.metaKey) parts.push("meta");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  parts.push(key === " " ? "space" : key);
  return parts.join("+");
}

/// Whether a captured combo is safe to bind: it needs a modifier so it can't
/// shadow typing. Function keys type nothing, so they bind on their own.
export function isBindableCombo(combo: string): boolean {
  return (
    /^(?:mod|ctrl|meta|alt)\+/.test(combo) ||
    /(?:^|\+)f(?:[1-9]|1[0-2])$/.test(combo)
  );
}

const KEY_LABELS: Record<string, string> = {
  space: "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  escape: "Esc",
  enter: "Enter",
  tab: "Tab",
};

/// Renders a stored combo string for display, e.g. "mod+shift+g" -> "⌘⇧G" on
/// macOS or "Ctrl+Shift+G" elsewhere.
export function formatCombo(combo: string): string {
  const mac = modIsMeta();
  return combo
    .split("+")
    .map((part) => {
      if (part === "mod") return mac ? "⌘" : "Ctrl";
      if (part === "ctrl") return mac ? "⌃" : "Ctrl";
      if (part === "meta") return mac ? "⌘" : "Win";
      if (part === "alt") return mac ? "⌥" : "Alt";
      if (part === "shift") return mac ? "⇧" : "Shift";
      return KEY_LABELS[part] ?? part.toUpperCase();
    })
    .join(mac ? "" : "+");
}

// These combinations are owned by the app/native menu, before user bindings.
const RESERVED_COMBOS = new Set([
  "mod+p",
  "mod+=",
  "mod+-",
  "mod+0",
  "mod+s",
  "mod+shift+s",
  "mod+n",
  "mod+o",
  "mod+w",
  "mod+shift+w",
  "mod+q",
  "mod+,",
  "mod+z",
  "mod+shift+z",
  "mod+y",
  "mod+a",
  "mod+c",
  "mod+x",
  "mod+v",
  "mod+shift+v",
  "mod+b",
  "mod+i",
  "mod+arrowleft",
  "mod+arrowright",
  "mod+arrowup",
  "mod+arrowdown",
  "mod+shift+arrowleft",
  "mod+shift+arrowright",
  "mod+shift+arrowup",
  "mod+shift+arrowdown",
  // Fixed AI keys: accept a pending edit, apply a grammar fix, cycle
  // completion candidates.
  "mod+enter",
  // Reject a pending edit, or keep the original of the sentence pointed at.
  "mod+backspace",
  "alt+enter",
  "alt+[",
  "alt+]",
  // Fullscreen by convention (and the app's own handler on Windows).
  "f11",
  // Round the window's regions, and through Textus AI's changes.
  "f6",
  "shift+f6",
  "f7",
  "shift+f7",
]);
// macOS's fixed Next/Previous Tab, Cmd+Shift+] and [, as a US keyboard
// records them with Shift held, and as written.
const MAC_RESERVED_COMBOS = new Set([
  "mod+shift+]",
  "mod+shift+[",
  "mod+shift+}",
  "mod+shift+{",
]);
export function isReservedCombo(combo: string): boolean {
  return (
    RESERVED_COMBOS.has(combo) ||
    combo === "mod+shift+n" ||
    (modIsMeta() ? MAC_RESERVED_COMBOS.has(combo) : combo === "alt+f4")
  );
}
