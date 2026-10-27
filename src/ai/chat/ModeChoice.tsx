import { useState } from "react";
import type { Strings, TextKey } from "../../i18n/strings";
import { AGENT_MODES, type AgentMode } from "../../prefs/settings-types";
import { CheckIcon, ChevronIcon } from "../../ui/icons";
import { useCloseOnOutsideClick } from "../../utils/hooks/useCloseOnOutsideClick";

const MODE_LABEL: Record<AgentMode, TextKey> = {
  write: "agentModeWrite",
  review: "agentModeReview",
  create: "agentModeCreate",
};

/** The modes a skill applies in, said quietly ("Write · Review"); a click
 *  opens them as a menu to tick, several at once, one at least. The menu
 *  stays beside its button: Settings is modal, and outside it nothing can
 *  be clicked. */
export function ModeChoice({
  t,
  modes,
  onChange,
}: {
  t: Strings;
  modes: AgentMode[];
  onChange: (modes: AgentMode[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useCloseOnOutsideClick<HTMLSpanElement>(
    () => setOpen(false),
    true,
    open,
  );
  const label = AGENT_MODES.filter((m) => modes.includes(m))
    .map((m) => t[MODE_LABEL[m]])
    .join(" · ");
  return (
    <span className="skill-mode-choice" ref={ref}>
      <button
        type="button"
        className="skill-mode-choice-button"
        aria-label={`${t.agentSkillsModes}: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <ChevronIcon className="skill-mode-choice-chevron" />
      </button>
      {open && (
        <span
          className="skill-mode-choice-menu floating-surface"
          role="menu"
          aria-label={t.agentSkillsModes}
        >
          {AGENT_MODES.map((mode) => {
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
                    AGENT_MODES.filter((m) =>
                      m === mode ? !on : modes.includes(m),
                    ),
                  );
                }}
              >
                <CheckIcon
                  className={`context-menu-check${on ? "" : " context-menu-check-off"}`}
                />
                {t[MODE_LABEL[mode]]}
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
}
