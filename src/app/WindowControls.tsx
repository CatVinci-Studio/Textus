import { useCallback, useRef, useState } from "react";
import { useSettings } from "../settings/SettingsContext";
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
 * The app menu's button: part of the window frame the app draws when the
 * OS no longer does - Windows and Linux; see platform/window-chrome.ts for
 * why they differ from macOS. The caption buttons beside it (minimise,
 * maximise, close) are ui/WindowCaptionButtons.tsx, shared with the chat
 * window. Both render nothing where the platform supplies its own frame,
 * so the macOS title row stays byte-for-byte what it was.
 */

/**
 * Opens the app menu, and owns everything about it that is not the menu
 * itself: where it is anchored, what dismisses it, and where focus goes
 * afterwards. AppMenu.tsx draws the items and says why they are drawn here
 * at all rather than popped as the real `Menu` through Rust.
 */
export function AppMenuButton({ checks }: { checks?: MenuChecks } = {}) {
  const { t } = useSettings();
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  // Whatever had focus when the menu opened - almost always the document.
  // The menu takes focus so the arrow keys work in it, and hands it straight
  // back on the way out, so using the menu never costs the user their caret.
  const focusOnClose = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setAnchor(null);
    focusOnClose.current?.focus();
    focusOnClose.current = null;
  }, []);

  // Deliberately wrapped round the button AS WELL as the menu (the same
  // shape QuickAskPendingBar's split button uses). The hook listens on
  // document in the capture phase, so a click on the button while the menu
  // is open would otherwise count as "outside": it would close the menu a
  // moment before the button's own onClick ran and reopened it, and the
  // button would appear not to close the menu at all.
  const ref = useCloseOnOutsideClick<HTMLDivElement>(
    close,
    true,
    anchor !== null,
  );

  // Windows and Linux, where the menu bar went with the OS frame - and the
  // iPhone, which never had one.
  if (!appDrawsWindowFrame && !isIOSApp) return null;

  return (
    <div ref={ref} className="window-menu-anchor">
      <Tooltip text={t.appMenu}>
        <button
          type="button"
          className="window-caption-button window-menu-button"
          aria-label={t.appMenu}
          aria-haspopup="menu"
          aria-expanded={anchor !== null}
          onClick={(e) => {
            if (anchor) {
              close();
              return;
            }
            if (isIOSApp) {
              // The phone: leave the editor, which takes the keyboard and the
              // system's "Paste | Format" bubble with it (that bubble belongs
              // to the selection and otherwise floats over the menu), and
              // don't hand focus back afterwards - it would only bring the
              // keyboard back up over whatever the menu just opened.
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
