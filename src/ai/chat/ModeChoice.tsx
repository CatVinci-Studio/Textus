import type { Strings, TextKey } from "../../i18n/strings";
import { AGENT_MODES, type AgentMode } from "../../settings/settings-types";

const MODE_LABEL: Record<AgentMode, TextKey> = {
  write: "agentModeWrite",
  review: "agentModeReview",
  create: "agentModeCreate",
};

/** The modes a skill is to apply in, as boxes: one at least, so the last
 *  one ticked can't be unticked. */
export function ModeChoice({
  t,
  modes,
  onChange,
}: {
  t: Strings;
  modes: AgentMode[];
  onChange: (modes: AgentMode[]) => void;
}) {
  return (
    <span
      className="skill-mode-choice"
      role="group"
      aria-label={t.agentSkillsModes}
    >
      {AGENT_MODES.map((mode) => {
        const on = modes.includes(mode);
        return (
          <label key={mode}>
            <input
              type="checkbox"
              checked={on}
              disabled={on && modes.length === 1}
              onChange={() =>
                onChange(
                  AGENT_MODES.filter((m) =>
                    m === mode ? !on : modes.includes(m),
                  ),
                )
              }
            />
            {t[MODE_LABEL[mode]]}
          </label>
        );
      })}
    </span>
  );
}
