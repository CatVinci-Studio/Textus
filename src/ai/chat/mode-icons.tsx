import type { AgentMode } from "../../settings/SettingsContext";
import { ReviewModeIcon, ReviseModeIcon, WriteModeIcon } from "../../ui/icons";

const ICONS = {
  write: WriteModeIcon,
  review: ReviewModeIcon,
  revise: ReviseModeIcon,
} satisfies Record<AgentMode, unknown>;

/** A mode's icon: in front of its name in the composer's picker and its
 *  menu, and large in the AI panel's empty state. */
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
