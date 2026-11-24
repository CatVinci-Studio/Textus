import { Suspense } from "react";
import { useSettings } from "../../prefs/SettingsContext";
import { useMenuOpen } from "../../engine/controls/useMenuOpen";
import { AppMenu } from "../menu/app-menu-lazy";
import type { MenuChecks } from "../../registry/menu/app-menu-model";
import { HamburgerIcon } from "../../engine/controls/icons";
import { appDrawsWindowFrame } from "../../platform/window-chrome";
import { Presence } from "../../engine/motion/usePresence";
import { isMobileApp } from "../../platform/capabilities";
import { Tooltip } from "../../engine/controls/Tooltip";
import "./window-controls.css";

/**
 * Opens the app menu and owns its anchoring, dismissal and focus return.
 * Renders nothing where the platform supplies its own frame.
 */
export function AppMenuButton({ checks }: { checks?: MenuChecks } = {}) {
  const { t } = useSettings();
  const {
    open: anchor,
    show,
    close,
    ref,
  } = useMenuOpen<{ x: number; y: number }>();

  // Where the menu bar went with the OS frame, and the iPhone.
  if (!appDrawsWindowFrame && !isMobileApp) return null;

  return (
    <div ref={ref} className="window-menu-anchor">
      <Tooltip text={t.appMenu}>
        <button
          type="button"
          className="window-menu-button"
          aria-label={t.appMenu}
          aria-haspopup="menu"
          aria-expanded={anchor !== null}
          // Pressed, it keeps the focus where it was, for the menu to give
          // back.
          onMouseDown={(e) => {
            if (!isMobileApp) e.preventDefault();
          }}
          onClick={(e) => {
            if (anchor) {
              close();
              return;
            }
            // Touch: blur the editor so the keyboard and the system's paste
            // bubble go, and don't hand focus back afterwards.
            if (isMobileApp)
              (document.activeElement as HTMLElement | null)?.blur();
            const rect = e.currentTarget.getBoundingClientRect();
            show({ x: rect.left, y: rect.bottom + 2 }, !isMobileApp);
          }}
        >
          <HamburgerIcon />
        </button>
      </Tooltip>
      <Presence show={anchor !== null}>
        {anchor && (
          <Suspense fallback={null}>
            <AppMenu
              x={anchor.x}
              y={anchor.y}
              onClose={close}
              anchor={ref.current}
              checks={checks}
            />
          </Suspense>
        )}
      </Presence>
    </div>
  );
}
