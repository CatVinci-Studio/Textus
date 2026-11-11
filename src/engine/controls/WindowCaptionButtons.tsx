import { useWindowState } from "../../platform/window-state";
import { thisWindow } from "../../platform/this-window";
import { useSettings } from "../../prefs/SettingsContext";
import {
  WindowCloseIcon,
  WindowMaximizeIcon,
  WindowMinimizeIcon,
  WindowRestoreIcon,
} from "./icons";
import { appDrawsWindowFrame } from "../../platform/window-chrome";
import { Tooltip } from "./Tooltip";
import "./window-caption.css";

/**
 * Minimise / maximise / close. Close goes through `close()`, not `destroy()`,
 * so onCloseRequested still runs (unsaved prompt, chat hand-back).
 */
export function WindowCaptionButtons() {
  const { t } = useSettings();
  const { maximized } = useWindowState();

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
