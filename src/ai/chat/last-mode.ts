import { storedAgentMode, type AgentMode } from "../../prefs/SettingsContext";
import { getUiState, setUiState } from "../../storage/ui-state";

/** The mode a conversation starts in, until another is picked. */
export const START_MODE: AgentMode = "review";

/** The panel's last mode, else `fallback`: one the panel and its composer
 *  both start from, so neither shows the other's for a frame. */
export function initialMode(fallback: AgentMode = START_MODE): AgentMode {
  const saved = getUiState("lastAgentMode");
  if (typeof saved !== "object" || saved === null) return fallback;
  return storedAgentMode((saved as { mode?: unknown }).mode) ?? fallback;
}

export function rememberMode(mode: AgentMode): void {
  setUiState("lastAgentMode", { mode });
}
