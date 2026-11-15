/** Whether a keydown is part of an IME composition: keyCode 229 covers
 *  WebKit keydowns where isComposing lags. React's events carry the native
 *  one. */
export function isImeKeydown(
  event: KeyboardEvent | { nativeEvent: KeyboardEvent },
): boolean {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
}

/** Whether an input method is composing somewhere in the page. */
let composing = false;
if (typeof window !== "undefined") {
  window.addEventListener("compositionstart", () => (composing = true), true);
  window.addEventListener("compositionend", () => (composing = false), true);
}

/**
 * Runs `then` once no input method is composing: at once, or after the
 * editor has taken the text it commits. A block changed under an open
 * composition (Windows hands Ctrl+3 to the page mid-pinyin) doubled the
 * text, or left it beside the heading's "# ".
 */
export function afterComposition(then: () => void): void {
  if (!composing) {
    then();
    return;
  }
  window.addEventListener("compositionend", () => setTimeout(then), {
    once: true,
    capture: true,
  });
}
