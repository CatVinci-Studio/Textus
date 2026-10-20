import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettings } from "../settings/SettingsContext";
import {
  WindowCloseIcon,
  WindowMaximizeIcon,
  WindowMinimizeIcon,
  WindowRestoreIcon,
} from "./icons";
import { appDrawsWindowFrame } from "../platform/window-chrome";
import { Tooltip } from "./Tooltip";
import "./window-caption.css";

/**
 * Minimise / maximise / close.
 *
 * Close goes through `close()`, not `destroy()`, so it lands in the same
 * onCloseRequested handler the native button used to reach: the editor still
 * gets its unsaved-document prompt, and the detached chat still hands its
 * conversation back for re-embedding.
 */
export function WindowCaptionButtons() {
  const { t } = useSettings();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!appDrawsWindowFrame) return;
    const win = getCurrentWindow();
    let alive = true;
    const sync = () => {
      void win
        .isMaximized()
        .then((v) => {
          if (alive) setMaximized(v);
        })
        .catch(() => {
          // No backend (dev shim) - the glyph just stays on "maximize".
        });
    };
    sync();
    // Maximising is not the only way into the state: Aero snap, Win+Up and a
    // double-click on the drag region all get there without going through
    // the button below, and a stale glyph would offer "maximize" on an
    // already-maximized window.
    // A drag-resize fires this every frame, and each sync is three IPC
    // round trips; only where the resize ends matters.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const unlisten = win.onResized(() => {
      clearTimeout(settle);
      settle = setTimeout(sync, 100);
    });
    return () => {
      alive = false;
      clearTimeout(settle);
      void unlisten.then((off) => off());
    };
  }, []);

  if (!appDrawsWindowFrame) return null;

  return (
    <div className="window-caption">
      <Tooltip text={t.windowMinimize}>
        <button
          type="button"
          className="window-caption-button"
          aria-label={t.windowMinimize}
          onClick={() => void getCurrentWindow().minimize()}
        >
          <WindowMinimizeIcon />
        </button>
      </Tooltip>
      <Tooltip text={maximized ? t.windowRestore : t.windowMaximize}>
        <button
          type="button"
          className="window-caption-button"
          aria-label={maximized ? t.windowRestore : t.windowMaximize}
          onClick={() => void getCurrentWindow().toggleMaximize()}
        >
          {maximized ? <WindowRestoreIcon /> : <WindowMaximizeIcon />}
        </button>
      </Tooltip>
      <Tooltip text={t.windowClose}>
        <button
          type="button"
          className="window-caption-button window-caption-close"
          aria-label={t.windowClose}
          onClick={() => void getCurrentWindow().close()}
        >
          <WindowCloseIcon />
        </button>
      </Tooltip>
    </div>
  );
}
