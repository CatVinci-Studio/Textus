import { useRef, useState } from "react";
import { useSettings, type Settings } from "../../prefs/SettingsContext";
import { showMessage } from "../../engine/controls/app-dialog";
import { useLatest } from "../../utils/hooks/useLatest";
import { currentStrings } from "../../i18n/current";
import { explainError } from "../../utils/error-explain";
import { withCreation } from "./creations";
import type { Creation } from "../../prefs/settings-values";

/** What an install under a reply made, and what else it sets. */
interface Made {
  made: Omit<Creation, "at">;
  settings?: (now: Settings) => Partial<Settings>;
}

/**
 * Installing what a reply wrote (a plugin, a theme): one at a time, busy
 * meanwhile, recorded among the AI's creations once done; a failure is said
 * in a message.
 */
export function useCreationAction() {
  const { settings, setSettings } = useSettings();
  const latest = useLatest(settings);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const run = async (install: () => Promise<Made>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const { made, settings: more } = await install();
      setSettings({
        ...more?.(latest.current),
        creations: withCreation(latest.current.creations, {
          ...made,
          at: Date.now(),
        }),
      });
    } catch (err) {
      await showMessage(explainError(err, currentStrings()), { tone: "error" });
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  return { busy, run };
}
