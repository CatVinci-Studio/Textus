import type { AgentMode } from "../../prefs/SettingsContext";
import { CreateModeIcon, ReviewModeIcon, WriteModeIcon } from "../../ui/icons";

const ICONS = {
  write: WriteModeIcon,
  review: ReviewModeIcon,
  create: CreateModeIcon,
} satisfies Record<AgentMode, unknown>;

/** A mode's icon, large in the AI panel's empty state (the composer's
 *  picker is words only). */
export function ModeIcon({
  mode,
  className,
}: {
  mode: AgentMode;
  className?: string;
}) {
  const Icon = ICONS[mode];
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
