/**
 * Whether a review step puts the caret back in the document. Never out of a
 * text field (a follow-up being typed would land in the document), never on
 * a phone (it raised the keyboard over the AI sheet), on an iPad only when
 * the editor had focus as the step began, on the desktop always.
 */
export function refocusAfterReview(state: {
  phone: boolean;
  /** The iOS app (with the phone excluded above: an iPad). */
  ios: boolean;
  /** The editor had focus when the step began. */
  editorHadFocus: boolean;
  /** A text field (the chat composer, a find bar) has focus now. */
  textFieldFocused: boolean;
}): boolean {
  if (state.textFieldFocused || state.phone) return false;
  if (state.ios) return state.editorHadFocus;
  return true;
}

/** How long a press counts as the start of the step it triggers. */
export const PRESS_WINDOW_MS = 1500;

/**
 * Whether the editor had focus when the user started the current action:
 * now, or at the last press, since a tap can move the focus away before the
 * button's click runs.
 */
export function editorFocusedBeforeAction(
  focusedNow: boolean,
  press: { focused: boolean; at: number } | null,
  now: number,
): boolean {
  if (focusedNow) return true;
  return !!press && press.focused && now - press.at < PRESS_WINDOW_MS;
}
