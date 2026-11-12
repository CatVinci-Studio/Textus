import { storedAgentMode, type AgentMode } from "../../prefs/SettingsContext";
import { getUiState, setUiState } from "../../storage/ui-state";

/** The mode a conversation starts in, until another is picked. */
export const START_MODE: AgentMode = "review";

/**
 * The panel's last mode, kept with the default it was picked under so a new
 * Settings default still takes effect.
 */
export function initialMode(defaultMode: AgentMode): AgentMode {
  // Unreadable or blocked storage reads as nothing kept: the default.
  const saved = getUiState("lastAgentMode");
  if (typeof saved !== "object" || saved === null) return defaultMode;
  const { mode: kept, under } = saved as { mode?: unknown; under?: unknown };
  const mode = storedAgentMode(kept);
  if (mode && storedAgentMode(under) === defaultMode) return mode;
  return defaultMode;
}

/** Not kept when storage refuses it: the next conversation starts at the
 *  default. */
export function rememberMode(mode: AgentMode, defaultMode: AgentMode): void {
  setUiState("lastAgentMode", { mode, under: defaultMode });
}
