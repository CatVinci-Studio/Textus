import { useLayoutEffect, useRef, useState } from "react";
import { MODES } from "../modes";
import type { Strings } from "../../i18n/strings";
import { CHAT_MODES, type ChatMode } from "../../prefs/settings-types";
import { CheckIcon, ChevronIcon } from "../../ui/icons";
import { useCloseOnOutsideClick } from "../../utils/hooks/useCloseOnOutsideClick";

/** The modes a skill applies in, said quietly ("Write · Review"); a click
 *  opens them as a menu to tick, several at once, one at least. The menu
 *  stays beside its button: Settings is modal, and outside it nothing can
 *  be clicked. */
export function ModeChoice({
  t,
  modes,
  disabled,
  onChange,
}: {
  t: Strings;
  modes: ChatMode[];
  /** The skill is off: its modes show, kept, but can't be changed. */
  disabled?: boolean;
  onChange: (modes: ChatMode[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useCloseOnOutsideClick<HTMLSpanElement>(
    () => setOpen(false),
    true,
    open,
  );
  // Below the button, or above it without room there: a menu hanging past
  // the bottom of a scrolled list (a reply's chip in a chat) makes the list
  // longer, and closing it on the press that follows shortens it again -
  // what was under the pointer moves, and the click misses.
  const menuRef = useRef<HTMLSpanElement>(null);
  const [up, setUp] = useState(false);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return;
    const button = ref.current!.getBoundingClientRect();
    const bottom = Math.min(window.innerHeight, scrollerBottom(ref.current!));
    const below = bottom - button.bottom;
    setUp(below < menu.offsetHeight + 8 && button.top > below);
  }, [open, ref]);
  const label = CHAT_MODES.filter((m) => modes.includes(m))
    .map((m) => t[MODES[m].label])
    .join(" · ");
  return (
    <span className="skill-mode-choice" ref={ref}>
      <button
        type="button"
        className="skill-mode-choice-button"
        aria-label={`${t.agentSkillsModes}: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <ChevronIcon className="skill-mode-choice-chevron" />
      </button>
      {open && (
        <span
          ref={menuRef}
          className={`skill-mode-choice-menu floating-surface${up ? " skill-mode-choice-menu-up" : ""}`}
          role="menu"
          aria-label={t.agentSkillsModes}
        >
          {CHAT_MODES.map((mode) => {
            const on = modes.includes(mode);
            return (
              <button
                key={mode}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                aria-disabled={on && modes.length === 1}
                className="context-menu-item"
                onClick={() => {
                  if (on && modes.length === 1) return;
                  onChange(
                    CHAT_MODES.filter((m) =>
                      m === mode ? !on : modes.includes(m),
                    ),
                  );
                }}
              >
                <CheckIcon
                  className={`context-menu-check${on ? "" : " context-menu-check-off"}`}
                />
                {t[MODES[mode].label]}
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
}

/** The bottom of the nearest box that scrolls `el`, or the window's. */
function scrollerBottom(el: HTMLElement): number {
  for (let e = el.parentElement; e; e = e.parentElement)
    if (/auto|scroll/.test(getComputedStyle(e).overflowY))
      return e.getBoundingClientRect().bottom;
  return window.innerHeight;
}
