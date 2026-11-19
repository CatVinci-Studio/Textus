import { hasSystemBack } from "../platform/capabilities";

/** Layers that close on Escape: sheets, modal dialogs, menus, and the find
 *  bar (its own Escape listener, outside the modal markup). */
const LAYERS = '.sheet, [aria-modal="true"], [role="menu"], .find-replace-bar';

const closers: (() => boolean)[] = [];

/** `close` runs on Android's Back when no layer is open, newest first; it
 *  answers whether it closed something (a pushed-in sidebar). Returns the
 *  undo. */
export function onBack(close: () => boolean): () => void {
  closers.push(close);
  return () => {
    const at = closers.indexOf(close);
    if (at !== -1) closers.splice(at, 1);
  };
}

/**
 * Android's Back: the open layer closes, as with Escape, else the newest
 * closer's part; false when there was nothing (MainActivity then puts the
 * app in the background).
 */
export function back(): boolean {
  // The Escape belongs to the layer: its handler is on it (a dialog's, a
  // menu's, the find bar's), while the focus may have been left elsewhere.
  const layer = [...document.querySelectorAll<HTMLElement>(LAYERS)]
    .filter((el) => el.getClientRects().length > 0)
    .at(-1);
  if (layer) {
    layer.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    return true;
  }
  return [...closers].reverse().some((close) => close());
}

export function installBack(): void {
  if (hasSystemBack)
    (window as { textusBack?: () => boolean }).textusBack = back;
}
