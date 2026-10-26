import { useCallback, useRef, useState } from "react";
import { useWindowEvent } from "../../utils/hooks/useWindowEvent";
import { useSettings } from "../../settings/SettingsContext";
import { useCloseOnOutsideClick } from "../../utils/hooks/useCloseOnOutsideClick";
import { usePluginMenuEntries } from "../../plugins/contributions/usePluginMenu";
import { Presence } from "../../ui/usePresence";
import { AppMenu } from "./AppMenu";
import {
  buildAppMenu,
  menuBarSections,
  NO_RECENTS,
  type MenuChecks,
} from "./app-menu-model";

/**
 * The app menu's top level laid out along the window bar - File, Edit,
 * View and the rest - where the app draws the frame (Windows, Linux) and
 * Settings › Editor & Appearance › Show the menu bar is on; otherwise the
 * menu is behind AppMenuButton's ☰. Each title opens its own list
 * (AppMenu's `section`); with one open, the pointer moving onto another
 * title or ← / → moves to that one, as a native menu bar does. A click
 * elsewhere or Escape closes it, and the focus goes back to where it was.
 */
export function MenuBar({ checks }: { checks?: MenuChecks }) {
  const { t, settings } = useSettings();
  const pluginEntries = usePluginMenuEntries(settings.language);
  const titles = menuBarSections(
    buildAppMenu(t, settings.shortcuts, NO_RECENTS, checks, pluginEntries),
  ).map((section) => section.label);
  const [open, setOpen] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const focusOnClose = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(null);
    focusOnClose.current?.focus();
    focusOnClose.current = null;
  }, []);
  // Round the titles and the open list both, so a click on a title isn't
  // "outside" (AppMenuButton explains).
  const ref = useCloseOnOutsideClick<HTMLDivElement>(
    close,
    true,
    open !== null,
  );

  // ← / → walk along the bar while a list is open. On the window, as the
  // focus may be on the list or still on a title; a submenu's own ← / →
  // stop before they get here (AppMenu's MenuList).
  useWindowEvent("keydown", (e) => {
    const key = (e as KeyboardEvent).key;
    if (!open || (key !== "ArrowLeft" && key !== "ArrowRight")) return;
    e.preventDefault();
    const step = key === "ArrowRight" ? 1 : -1;
    openAt((open.index + step + titles.length) % titles.length);
  });

  const openAt = (index: number) => {
    const button = buttons.current[index];
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setOpen({ index, x: rect.left, y: rect.bottom + 2 });
  };

  return (
    <div
      ref={ref}
      className="window-menu-bar"
      role="menubar"
      aria-label={t.appMenu}
    >
      {titles.map((title, index) => (
        <button
          key={title}
          ref={(el) => {
            buttons.current[index] = el;
          }}
          type="button"
          role="menuitem"
          className="window-menu-bar-title"
          aria-haspopup="menu"
          aria-expanded={open?.index === index}
          onMouseEnter={() => {
            if (open && open.index !== index) openAt(index);
          }}
          onClick={() => {
            if (open?.index === index) return close();
            if (!open)
              focusOnClose.current =
                document.activeElement as HTMLElement | null;
            openAt(index);
          }}
        >
          {title}
        </button>
      ))}
      <Presence show={open !== null} exitMs={120}>
        {open && (
          // A list of its own per title, so the arrow keys start on its
          // first row each time.
          <AppMenu
            key={open.index}
            x={open.x}
            y={open.y}
            section={open.index}
            onClose={close}
            checks={checks}
          />
        )}
      </Presence>
    </div>
  );
}
