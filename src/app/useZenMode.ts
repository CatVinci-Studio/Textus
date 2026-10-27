import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { ZEN_MODE_EVENT } from "../utils/events";

/**
 * Zen mode: only the text. Chrome goes away and every paragraph but the
 * current one dims. Esc leaves.
 */
export function useZenMode() {
  const [zenMode, setZenMode] = useState(false);
  const toggleZenMode = useCallback(() => setZenMode((on) => !on), []);
  // Before paint: the text column's glide measures the layout this class
  // makes.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("zen", zenMode);
  }, [zenMode]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(ZEN_MODE_EVENT, { detail: zenMode }));
  }, [zenMode]);
  useEffect(() => {
    if (!zenMode) return;
    // Capture phase: the editor handles Escape itself. Anything on screen
    // that Escape should close first keeps it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.isComposing || e.keyCode === 229) return;
      if (
        document.querySelector(
          ':is([role="dialog"], [role="menu"], .inline-chat, .find-replace-bar, .context-menu):not([data-state="closing"] *, [data-state="closing"])',
        )
      )
        return;
      setZenMode(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [zenMode]);

  return { zenMode, setZenMode, toggleZenMode };
}
