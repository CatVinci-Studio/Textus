import { useEffect, useState } from "react";
import { thisWindow } from "../platform/this-window";
import { useSettings } from "../prefs/SettingsContext";
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
 * Minimise / maximise / close. Close goes through `close()`, not `destroy()`,
 * so onCloseRequested still runs (unsaved prompt, chat hand-back).
 */
export function WindowCaptionButtons() {
  const { t } = useSettings();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!appDrawsWindowFrame) return;
    const win = thisWindow();
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
    // Snap, Win+Up and a double-click on the drag region also maximise, so the
    // glyph follows resizes. A drag-resize fires every frame and each sync is
    // three IPC round trips; only where the resize ends matters.
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
          onClick={() => void thisWindow().minimize()}
        >
          <WindowMinimizeIcon />
        </button>
      </Tooltip>
      <Tooltip text={maximized ? t.windowRestore : t.windowMaximize}>
        <button
          type="button"
          className="window-caption-button"
          aria-label={maximized ? t.windowRestore : t.windowMaximize}
          onClick={() => void thisWindow().toggleMaximize()}
        >
          {maximized ? <WindowRestoreIcon /> : <WindowMaximizeIcon />}
        </button>
      </Tooltip>
      <Tooltip text={t.windowClose}>
        <button
          type="button"
          className="window-caption-button window-caption-close"
          aria-label={t.windowClose}
          onClick={() => void thisWindow().close()}
        >
          <WindowCloseIcon />
        </button>
      </Tooltip>
    </div>
  );
}
