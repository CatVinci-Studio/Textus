import { useEffect } from "react";

/** Fixed-position popups close when the page moves under them, since they
 *  would point at the wrong text. A phone's action sheets are exempt. */
export function usePopupDismiss({
  anyPopup,
  setMenu,
  hideGrammar,
  settingsRef,
}: {
  anyPopup: boolean;
  /** The context menu's state setter (stable); called with null. */
  setMenu: (menu: null) => void;
  hideGrammar: () => void;
  settingsRef: { readonly current: { typewriterMode: boolean } };
}) {
  useEffect(() => {
    if (!anyPopup) return;
    const close = () => {
      setMenu(null);
      hideGrammar();
    };
    // Typewriter mode scrolls on every caret move, so there a scroll only
    // closes the menu. A menu scrolling inside itself stays open.
    const onScroll = (e: Event) => {
      if (e.target instanceof Element && e.target.closest(".floating-surface"))
        return;
      setMenu(null);
      if (!settingsRef.current.typewriterMode) hideGrammar();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [anyPopup, setMenu, hideGrammar, settingsRef]);
}
