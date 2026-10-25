// How a key is named to a plugin that holds the keyboard
// (editor-input.ts): Vim's and Emacs's keys.

/** A key as a plugin sees it: "a", "A", "$", "Escape", "Enter",
 *  "ctrl+r", "alt+f", "shift+Tab". */
export function keyName(event: KeyboardEvent): string {
  const mods: string[] = [];
  if (event.ctrlKey) mods.push("ctrl");
  if (event.altKey) mods.push("alt");
  if (event.metaKey) mods.push("meta");
  const printable = event.key.length === 1;
  if (event.shiftKey && !printable) mods.push("shift");
  const key =
    printable && event.altKey
      ? altKey(event)
      : printable && event.ctrlKey
        ? event.key.toLowerCase()
        : event.key;
  return [...mods, key].join("+");
}

/** The key under an Option (Alt) chord by where it is on the keyboard: on
 *  a Mac, Option+F types "ƒ", but Emacs's M-f means the F key. Keys
 *  outside the letters, digits and these marks keep what they typed. */
const ALT_MARKS: Record<string, [string, string]> = {
  Comma: [",", "<"],
  Period: [".", ">"],
  BracketLeft: ["[", "{"],
  BracketRight: ["]", "}"],
  Slash: ["/", "?"],
  Minus: ["-", "_"],
  Semicolon: [";", ":"],
  Space: [" ", " "],
};
function altKey(event: KeyboardEvent): string {
  const letter = /^Key([A-Z])$/.exec(event.code);
  if (letter) return letter[1].toLowerCase();
  const digit = /^Digit([0-9])$/.exec(event.code);
  if (digit) return digit[1];
  const mark = ALT_MARKS[event.code];
  if (mark) return mark[event.shiftKey ? 1 : 0];
  return event.key.toLowerCase();
}
