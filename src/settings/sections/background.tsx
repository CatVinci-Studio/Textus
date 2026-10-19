import { useEffect, useState } from "react";
import type { Strings } from "../../i18n/strings";
import {
  background,
  BACKGROUND_STATUS,
  type BackgroundStatus,
} from "../../platform/ipc";
import { isMacPlatform, isWindowsPlatform } from "../../platform/os";
import { listenToThisWindow, unlistenAll } from "../../utils/tauri-events";
import { useSettings } from "../SettingsContext";
import { ToggleRow } from "./controls";

/** Rust's view of the tray and the login item: asked once, then kept
 *  current by the event it sends every window after each change
 *  (src-tauri/src/background/). */
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

function backgroundHint(t: Strings): string {
  if (isMacPlatform()) return t.backgroundHintMac;
  if (isWindowsPlatform()) return t.backgroundHintWindows;
  return t.backgroundHintLinux;
}

/**
 * Settings › General › Background: whether closing the last window leaves
 * Textus running with a tray (menu bar) icon, and whether it starts that
 * way at login. Both off by default. Desktop only; Rust does the work
 * (src-tauri/src/background/).
 */
export function BackgroundSection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const status = useBackgroundStatus();
  const trayMissing =
    settings.runInBackground && status?.tray === "unavailable";
  const loginFailed =
    settings.runInBackground &&
    settings.openAtLogin &&
    status?.login === "failed";
  return (
    <>
      <ToggleRow
        label={t.backgroundToggle}
        help={backgroundHint(t)}
        checked={settings.runInBackground}
        onChange={(v) => setSettings({ runInBackground: v })}
      />
      {trayMissing && (
        <div className="settings-error" role="status" data-tray="unavailable">
          {t.backgroundTrayUnavailable}
        </div>
      )}
      {settings.runInBackground && (
        <ToggleRow
          label={t.openAtLoginToggle}
          checked={settings.openAtLogin}
          onChange={(v) => setSettings({ openAtLogin: v })}
        />
      )}
      {loginFailed && (
        <div className="settings-error" role="alert">
          {t.openAtLoginFailed.replace("{error}", status?.loginError ?? "")}
        </div>
      )}
    </>
  );
}
