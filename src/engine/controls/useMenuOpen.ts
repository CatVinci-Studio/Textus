import { useCallback, useRef, useState } from "react";
import { useCloseOnOutsideClick } from "../../utils/hooks/useCloseOnOutsideClick";

/**
 * Whether, and where (`T`), a menu its own buttons open is shown - for one
 * that isn't the context menu (`useMenuButton` hangs that one). A click
 * outside `ref`, which wraps the buttons as well as the menu, closes it, and
 * closing gives the focus back to where it was when it opened.
 */
export function useMenuOpen<T>() {
  const [open, setOpen] = useState<T | null>(null);
  // The menu takes focus for the arrow keys and hands it straight back, so
  // using it never costs the caret.
  const focusOnClose = useRef<HTMLElement | null>(null);
  const close = useCallback(() => {
    setOpen(null);
    focusOnClose.current?.focus({ preventScroll: true });
    focusOnClose.current = null;
  }, []);
  // Round the buttons too: the capture-phase listener would otherwise close
  // the menu just before a button's click reopens it.
  const ref = useCloseOnOutsideClick<HTMLDivElement>(
    close,
    true,
    open !== null,
  );
  /** Opens it at `at`, or moves it there; opening, it notes the focus to
   *  give back, unless `returnFocus` is false. */
  const show = (at: T, returnFocus = true) => {
    if (open === null)
      focusOnClose.current = returnFocus
        ? (document.activeElement as HTMLElement | null)
        : null;
    setOpen(at);
  };
  return { open, show, close, ref };
}
