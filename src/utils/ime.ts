/** Whether a keydown is part of an IME composition: keyCode 229 covers
 *  WebKit keydowns where isComposing lags. React's events carry the native
 *  one. */
export function isImeKeydown(
  event: KeyboardEvent | { nativeEvent: KeyboardEvent },
): boolean {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
}

/** Whether an input method is composing somewhere in the page, and what
 *  waits for it to end. */
let composing = false;
let waiting: (() => void)[] = [];
if (typeof window !== "undefined") {
  window.addEventListener("compositionstart", () => (composing = true), true);
  window.addEventListener(
    "compositionend",
    () => {
      composing = false;
      const run = waiting;
      waiting = [];
      // After the editor has taken the text it commits.
      if (run.length) setTimeout(() => run.forEach((then) => then()));
    },
    true,
  );
  // A composition whose end never came (its editor gone, the window left)
  // ends with the focus: else a heading key would wait for it forever. What
  // waited on it goes too: it was for where the writer was, not for the
  // next composition, somewhere else.
  const lost = () => {
    composing = false;
    waiting = [];
  };
  window.addEventListener("blur", lost);
  window.addEventListener("focusout", lost, true);
  document.addEventListener("visibilitychange", lost);
}

/**
 * Runs `then` once no input method is composing: at once, or after the
 * editor has taken the text it commits. A block changed under an open
 * composition (Windows hands Ctrl+3 to the page mid-pinyin) doubled the
 * text, or left it beside the heading's "# ".
 */
export function afterComposition(then: () => void): void {
  if (composing) waiting.push(then);
  else then();
}
