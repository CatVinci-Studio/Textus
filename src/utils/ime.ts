/** Whether a keydown is part of an IME composition: keyCode 229 covers
 *  WebKit keydowns where isComposing lags. React's events carry the native
 *  one. */
export function isImeKeydown(
  event: KeyboardEvent | { nativeEvent: KeyboardEvent },
): boolean {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
}
