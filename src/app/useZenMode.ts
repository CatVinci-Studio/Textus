import { useCallback, useEffect, useLayoutEffect } from "react";
import { ZEN_MODE_EVENT } from "../utils/events";
import { useSettings } from "../prefs/SettingsContext";

/**
 * Zen mode: only the text. Chrome goes away and every paragraph but the
 * current one dims. The × at the top right leaves (ZenExit). One for
 * every window (Settings' zenMode).
 */
export function useZenMode() {
  const { settings, setSettings } = useSettings();
  const zenMode = settings.zenMode;
  const setZenMode = useCallback(
    (on: boolean) => setSettings({ zenMode: on }),
    [setSettings],
  );
  const toggleZenMode = useCallback(
    () => setZenMode(!zenMode),
    [zenMode, setZenMode],
  );
  // Before paint: the text column's glide measures the layout this class
  // makes.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("zen", zenMode);
  }, [zenMode]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(ZEN_MODE_EVENT, { detail: zenMode }));
  }, [zenMode]);

  return { zenMode, setZenMode, toggleZenMode };
}
