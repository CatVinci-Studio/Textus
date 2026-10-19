import { useEffect, useRef } from "react";

/// Shared "click outside (or press Escape) to close" wiring for transient
/// overlays (menus, popovers) - attach the returned ref to the element that
/// holds both the overlay and the control that opens it. Listens in the
/// capture phase after a tick so the click/keypress that opened the overlay
/// doesn't also immediately close it.
///
/// `open` must say whether the overlay is showing: a component that stays
/// mounted with its menu closed (the AI panel's project bar, the Windows
/// menu button) otherwise kept swallowing every Escape in the window.
export function useCloseOnOutsideClick<T extends HTMLElement>(
  onClose: () => void,
  closeOnEscape = false,
  open = true,
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    // Both a touch's pointerdown and the mousedown WebKit may synthesise
    // after it reach here; the overlay closes once.
    let closed = false;
    function onPointerDown(e: MouseEvent) {
      if (closed) return;
      // A mouse press is handled at its mousedown, as it always was.
      if (
        e.type === "pointerdown" &&
        (e as PointerEvent).pointerType === "mouse"
      )
        return;
      const target = e.target as Node;
      // A Select's open list, the app menu and an InfoTip's card are
      // portalled to <body>; a click in them is still a click inside
      // whatever opened them.
      if (
        target instanceof Element &&
        target.closest(
          "[data-floating-select], [data-floating-menu], [data-floating-tip]",
        )
      )
        return;
      if (ref.current && !ref.current.contains(target)) {
        closed = true;
        onClose();
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key !== "Escape") return;
      // One Escape closes one thing: the overlay, not also the find bar
      // (whose listener sits on window, after this one on document).
      e.stopPropagation();
      onClose();
    }
    // An Escape pressed outside the overlay - the editor keeps the focus
    // while its context menu is open - is taken before it reaches its
    // target: bubbling, the editor's own Escape (clear the suggestion)
    // had already run by the time the menu heard it. One pressed inside
    // still bubbles, so a field in the overlay (a rename box, an open
    // Select) can keep its Escape for itself.
    function onKeyDownOutside(e: KeyboardEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest(
          "[data-floating-select], [data-floating-menu], [data-floating-tip]",
        )
      )
        return;
      onKeyDown(e);
    }
    const id = setTimeout(() => {
      document.addEventListener("mousedown", onPointerDown, true);
      // iOS sends no mousedown for a tap on something that isn't clickable
      // (the page's text, an empty stretch of the title row), so a menu
      // stayed open under a finger that tapped beside it. A touch's
      // pointerdown arrives wherever it lands.
      document.addEventListener("pointerdown", onPointerDown, true);
      if (closeOnEscape) {
        document.addEventListener("keydown", onKeyDownOutside, true);
        document.addEventListener("keydown", onKeyDown);
      }
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      if (closeOnEscape) {
        document.removeEventListener("keydown", onKeyDownOutside, true);
        document.removeEventListener("keydown", onKeyDown);
      }
    };
  }, [onClose, closeOnEscape, open]);

  return ref;
}
