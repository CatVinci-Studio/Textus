import { useEffect, useState } from "react";
import type { Strings } from "../../i18n/strings";
import {
  background,
  BACKGROUND_STATUS,
  type BackgroundStatus,
} from "../../platform/ipc";
import { listenToThisWindow, unlistenAll } from "../../utils/tauri-events";
import { useSettings } from "../SettingsContext";
import { ToggleRow } from "./controls";

/** Rust's view of the tray: asked once, then kept current by the event it
 *  sends every window after each change (src-tauri/src/background/). */
function useBackgroundStatus(): BackgroundStatus | null {
  const [status, setStatus] = useState<BackgroundStatus | null>(null);
  useEffect(() => {
    let alive = true;
    void background
      .status()
      .then((s) => {
        if (alive && s) setStatus((now) => now ?? s);
      })
      .catch(() => {});
    const unlisten = unlistenAll(
      listenToThisWindow<BackgroundStatus>(BACKGROUND_STATUS, (event) =>
        setStatus(event.payload),
      ),
    );
    return () => {
      alive = false;
      unlisten();
    };
  }, []);
  return status;
}

/**
 * Settings › General › App: whether closing the last window leaves Textus
 * running with a tray (menu bar) icon. Off by default. Desktop only; Rust
 * does the work (src-tauri/src/background/).
 */
export function BackgroundSection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const status = useBackgroundStatus();
  const trayMissing =
    settings.runInBackground && status?.tray === "unavailable";
  return (
    <>
      <ToggleRow
        label={t.backgroundToggle}
        checked={settings.runInBackground}
        onChange={(v) => setSettings({ runInBackground: v })}
      />
      {trayMissing && (
        <div className="settings-error" role="status" data-tray="unavailable">
          {t.backgroundTrayUnavailable}
        </div>
      )}
    </>
  );
}
