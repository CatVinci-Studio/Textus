/** The parts of a keydown the window's keys look at. */
export interface QuickNoteKey {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
}

export interface QuickNoteKeyState {
  /** compositionstart seen and its compositionend not yet settled. */
  composing: boolean;
  findOpen: boolean;
  /** Something nearer the caret has Escape of its own: an open menu or
   *  dialog, or a field (a code block's language, a math source) the key
   *  was typed in. */
  popoverOpen: boolean;
  mac: boolean;
}

/**
 * Whether a key press saves the note and closes the window: Escape,
 * ⌘/Ctrl+Enter, ⌘/Ctrl+S and ⌘/Ctrl+W.
 *
 * Never while an input method is composing - Escape there cancels the
 * candidate and Enter commits it, and closing the window would take the
 * half-typed word with it. WebKit reports a composition three ways and
 * not always all of them (`isComposing`, keyCode 229, and the
 * compositionstart/end the window tracks as `composing`), so any one is
 * enough. Escape also gives way to whatever is open nearer the text first:
 * the find bar, a menu, a field. (Not to `defaultPrevented`: the editor's
 * own Escape - select the enclosing block - takes every press.)
 */
export function savesAndCloses(
  e: QuickNoteKey,
  state: QuickNoteKeyState,
): boolean {
  if (e.isComposing || e.keyCode === 229 || state.composing) return false;
  if (e.key === "Escape")
    return !state.findOpen && !state.popoverOpen && !e.altKey;
  const mod = state.mac ? e.metaKey : e.ctrlKey;
  const other = state.mac ? e.ctrlKey : e.metaKey;
  if (!mod || other || e.altKey || e.shiftKey) return false;
  const key = e.key.toLowerCase();
  return key === "enter" || key === "s" || key === "w";
}
