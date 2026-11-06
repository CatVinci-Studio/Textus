import type { AgentMode } from "../../prefs/SettingsContext";
import { MODES } from "../modes";

/** A mode's icon, large in the AI panel's empty state (the composer's
 *  picker is words only). */
export function ModeIcon({
  mode,
  className,
}: {
  mode: AgentMode;
  className?: string;
}) {
  const Icon = MODES[mode].icon;
  return (
    <span
      className={`chat-mode-icon${className ? ` ${className}` : ""}`}
      data-mode={mode}
      aria-hidden="true"
    >
      <Icon />
    </span>
  );
}
