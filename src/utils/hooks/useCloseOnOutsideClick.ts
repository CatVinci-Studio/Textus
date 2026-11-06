import { useEffect, useRef } from "react";
import { isImeKeydown } from "../ime";

/// "Click outside (or press Escape) to close" for menus and popovers - the
/// one way every overlay closes; attach the ref to the element holding both
/// the overlay and its opener. `open` matters: a mounted closed menu would
/// otherwise swallow every Escape. `inside`: more elements that count as
/// inside - a selector (a review note's badge) or the element itself (the
/// button a menu hangs from).
export function useCloseOnOutsideClick<T extends HTMLElement>(
  onClose: () => void,
  closeOnEscape = false,
  open = true,
  inside: string | HTMLElement | null = "",
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    // Both a touch's pointerdown and the mousedown WebKit may synthesise
    // after it reach here; the overlay closes once.
    let closed = false;
    function onPointerDown(e: MouseEvent) {
      if (closed) return;
      // A mouse press is handled at its mousedown.
      if (
        e.type === "pointerdown" &&
        (e as PointerEvent).pointerType === "mouse"
      )
        return;
      const target = e.target as Node;
      // Selects, the app menu and InfoTips are portalled to <body>; a click in
      // them still counts as inside.
      if (isInside(target)) return;
      // Without an element of its own, `inside` alone says what is in.
      if (ref.current ? !ref.current.contains(target) : !!inside) {
        closed = true;
        onClose();
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (isImeKeydown(e)) return;
      if (e.key !== "Escape") return;
      // One Escape closes one thing: the overlay, not also the find bar.
      e.stopPropagation();
      onClose();
    }
    // An Escape outside the overlay (the editor keeps focus under its context
    // menu) is taken in capture, before the editor's own Escape; one inside still
    // bubbles so a field in the overlay keeps it.
    function onKeyDownOutside(e: KeyboardEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target) || isInside(target)) return;
      onKeyDown(e);
    }
    function isInside(target: Node) {
      if (inside instanceof HTMLElement && inside.contains(target)) return true;
      const named = typeof inside === "string" && inside ? `, ${inside}` : "";
      return (
        target instanceof Element &&
        !!target.closest(
          `[data-floating-select], [data-floating-menu], [data-floating-tip]${named}`,
        )
      );
    }
    const id = setTimeout(() => {
      document.addEventListener("mousedown", onPointerDown, true);
      // iOS sends no mousedown for a tap on something not clickable; a touch's
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
  }, [onClose, closeOnEscape, open, inside]);

  return ref;
}
