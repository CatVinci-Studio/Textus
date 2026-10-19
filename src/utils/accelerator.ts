/// Global-shortcut accelerators - the Quick Note shortcut, which the OS
/// delivers whichever app is in front. Stored as the string Rust registers
/// (src-tauri/src/commands/quick_note/shortcut.rs): modifiers first, in the
/// order Control, Alt, Shift, Super, then the key by its physical position
/// ("Control+Alt+N", "Super+Alt+N", "Control+Shift+F5").
///
/// The key is read from `KeyboardEvent.code`, not `.key`: on a Mac, Option
/// changes the character (⌥N types "˜"), and on other layouts a letter's
/// character isn't the one printed in the shortcut - the OS matches the
/// physical key, so that is what is recorded.
import { isMacPlatform, isWindowsPlatform } from "../platform/os";

export type AcceleratorOs = "mac" | "windows" | "linux";

export function currentAcceleratorOs(): AcceleratorOs {
  if (isMacPlatform()) return "mac";
  if (isWindowsPlatform()) return "windows";
  return "linux";
}

/// The default per platform - shortcut.rs's default_accelerator, which
/// explains why Windows differs (Ctrl+Alt is AltGr there).
export function defaultQuickNoteAccelerator(
  os: AcceleratorOs = currentAcceleratorOs(),
): string {
  return os === "windows" ? "Super+Alt+N" : "Control+Alt+N";
}

const MODIFIER_ORDER = ["Control", "Alt", "Shift", "Super"] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
  "CapsLock",
  "Fn",
]);

interface KeyLike {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/// The accelerator a key press makes, or null while only modifiers are
/// held (not a complete combination yet) or for a key the OS can't bind.
export function acceleratorFromEvent(e: KeyLike): string | null {
  if (!e.code || MODIFIER_CODES.has(e.code)) return null;
  const key = keyName(e.code);
  if (!key) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Control");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");
  return [...parts, key].join("+");
}

/// A `KeyboardEvent.code` as the accelerator names it: letters and digits
/// bare ("N", "1"), everything else under its code name, which Rust's
/// parser reads as well ("Space", "F5", "Minus", "ArrowUp").
function keyName(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (
    /^(Numpad[0-9]|Numpad(Add|Subtract|Multiply|Divide|Decimal|Enter|Equal))$/.test(
      code,
    )
  )
    return code;
  return [
    "Space",
    "Enter",
    "Tab",
    "Backspace",
    "Delete",
    "Insert",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Minus",
    "Equal",
    "BracketLeft",
    "BracketRight",
    "Backslash",
    "Semicolon",
    "Quote",
    "Backquote",
    "Comma",
    "Period",
    "Slash",
  ].includes(code)
    ? code
    : null;
}

function parse(
  accelerator: string,
): { modifiers: Set<Modifier>; key: string } | null {
  const parts = accelerator.split("+").filter(Boolean);
  const key = parts.pop();
  if (!key) return null;
  const modifiers = new Set<Modifier>();
  for (const part of parts) {
    const name = MODIFIER_ORDER.find(
      (m) => m.toLowerCase() === part.toLowerCase(),
    );
    if (!name) return null;
    modifiers.add(name);
  }
  return { modifiers, key };
}

const KEY_SYMBOLS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

/// How the platform writes the combination: "⌃⌥N" on a Mac (in the Mac's
/// order, ⌃⌥⇧⌘), "Ctrl+Alt+N" on Linux, "Win+Alt+N" on Windows.
export function formatAccelerator(
  accelerator: string,
  os: AcceleratorOs = currentAcceleratorOs(),
): string {
  const parsed = parse(accelerator);
  if (!parsed) return accelerator;
  const key = KEY_SYMBOLS[parsed.key] ?? parsed.key;
  if (os === "mac") {
    const symbols: Record<Modifier, string> = {
      Control: "⌃",
      Alt: "⌥",
      Shift: "⇧",
      Super: "⌘",
    };
    return (
      MODIFIER_ORDER.filter((m) => parsed.modifiers.has(m))
        .map((m) => symbols[m])
        .join("") + key
    );
  }
  const names: Record<Modifier, string> = {
    Control: "Ctrl",
    Alt: "Alt",
    Shift: "Shift",
    Super: os === "windows" ? "Win" : "Super",
  };
  // Win first on Windows, as the OS writes its own (Win+Shift+S).
  const order: Modifier[] =
    os === "windows"
      ? ["Super", "Control", "Alt", "Shift"]
      : ["Control", "Alt", "Shift", "Super"];
  return [
    ...order.filter((m) => parsed.modifiers.has(m)).map((m) => names[m]),
    key,
  ].join("+");
}

/// The accelerator as the app's own combo strings write it
/// (utils/shortcuts.ts: "mod" is ⌘ on a Mac and Ctrl elsewhere), to compare
/// with the in-app shortcuts.
export function comboFromAccelerator(
  accelerator: string,
  os: AcceleratorOs = currentAcceleratorOs(),
): string | null {
  const parsed = parse(accelerator);
  if (!parsed) return null;
  const { modifiers: m } = parsed;
  const parts: string[] = [];
  if (os === "mac") {
    if (m.has("Super")) parts.push("mod");
    if (m.has("Control")) parts.push("ctrl");
  } else {
    if (m.has("Control")) parts.push("mod");
    if (m.has("Super")) parts.push("meta");
  }
  if (m.has("Alt")) parts.push("alt");
  if (m.has("Shift")) parts.push("shift");
  // `KeyboardEvent.key`, lowercased, as a US layout gives it.
  const key = parsed.key.startsWith("Arrow")
    ? parsed.key
    : (KEY_SYMBOLS[parsed.key] ?? parsed.key);
  parts.push(key.toLowerCase());
  return parts.join("+");
}

/// What is wrong with an accelerator as the Quick Note shortcut, before
/// Rust is asked: the modifier rule shortcut.rs also enforces, and the
/// combinations Textus uses itself (`taken`, as combo strings) - a global
/// shortcut would take those from Textus's own windows. The OS's reserved
/// combinations are Rust's to judge; it reports them as the status.
export function acceleratorProblem(
  accelerator: string,
  taken: readonly string[],
  os: AcceleratorOs = currentAcceleratorOs(),
): "tooFewModifiers" | "inApp" | null {
  const parsed = parse(accelerator);
  if (!parsed) return "tooFewModifiers";
  const count = parsed.modifiers.size;
  const functionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(parsed.key);
  if (count < 2 && !(count === 1 && functionKey)) return "tooFewModifiers";
  const combo = comboFromAccelerator(accelerator, os);
  if (combo && taken.includes(combo)) return "inApp";
  return null;
}
