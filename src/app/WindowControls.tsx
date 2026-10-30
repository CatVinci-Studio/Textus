import { useCallback, useRef, useState } from "react";
import { useSettings } from "../prefs/SettingsContext";
import { useCloseOnOutsideClick } from "../utils/hooks/useCloseOnOutsideClick";
import { AppMenu } from "./menu/AppMenu";
import type { MenuChecks } from "./menu/app-menu-model";
import { HamburgerIcon } from "../ui/icons";
import { appDrawsWindowFrame } from "../platform/window-chrome";
import { Presence } from "../ui/usePresence";
import { isIOSApp } from "../platform/capabilities";
import { Tooltip } from "../ui/Tooltip";
import "./window-controls.css";

/**
 * Opens the app menu and owns its anchoring, dismissal and focus return.
 * Renders nothing where the platform supplies its own frame.
 */
export function AppMenuButton({ checks }: { checks?: MenuChecks } = {}) {
  const { t } = useSettings();
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  // The menu takes focus for the arrow keys and hands it straight back, so
  // using it never costs the caret.
  const focusOnClose = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setAnchor(null);
    focusOnClose.current?.focus();
    focusOnClose.current = null;
  }, []);

  // Wrapped round the button as well as the menu: the capture-phase listener
  // would otherwise close the menu just before the button's click reopens it.
  const ref = useCloseOnOutsideClick<HTMLDivElement>(
    close,
    true,
    anchor !== null,
  );

  // Where the menu bar went with the OS frame, and the iPhone.
  if (!appDrawsWindowFrame && !isIOSApp) return null;

  return (
    <div ref={ref} className="window-menu-anchor">
      <Tooltip text={t.appMenu}>
        <button
          type="button"
          className="window-menu-button"
          aria-label={t.appMenu}
          aria-haspopup="menu"
          aria-expanded={anchor !== null}
          onClick={(e) => {
            if (anchor) {
              close();
              return;
            }
            if (isIOSApp) {
              // The phone: blur the editor so the keyboard and the system's
              // paste bubble go, and don't hand focus back afterwards.
              (document.activeElement as HTMLElement | null)?.blur();
              focusOnClose.current = null;
            } else {
              focusOnClose.current =
                document.activeElement as HTMLElement | null;
            }
            const rect = e.currentTarget.getBoundingClientRect();
            setAnchor({ x: rect.left, y: rect.bottom + 2 });
          }}
        >
          <HamburgerIcon />
        </button>
      </Tooltip>
      <Presence show={anchor !== null} exitMs={120}>
        {anchor && (
          <AppMenu x={anchor.x} y={anchor.y} onClose={close} checks={checks} />
        )}
      </Presence>
    </div>
  );
}
