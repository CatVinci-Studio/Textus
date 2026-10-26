import {
  storedAgentMode,
  type AgentMode,
} from "../../settings/SettingsContext";
import { LOCAL_KEYS, readLocalJson, writeLocal } from "../../storage/local";

/**
 * The panel's last mode, kept with the default it was picked under so a new
 * Settings default still takes effect. In localStorage so the detached
 * window sees it.
 */
export function initialMode(defaultMode: AgentMode): AgentMode {
  // Unreadable or blocked storage reads as nothing kept: the default.
  const saved = readLocalJson(LOCAL_KEYS.lastMode);
  if (typeof saved !== "object" || saved === null) return defaultMode;
  const { mode: kept, under } = saved as { mode?: unknown; under?: unknown };
  const mode = storedAgentMode(kept);
  if (mode && storedAgentMode(under) === defaultMode) return mode;
  return defaultMode;
}

/** Not kept when storage refuses it: the next conversation starts at the
 *  default. */
export function rememberMode(mode: AgentMode, defaultMode: AgentMode): void {
  writeLocal(LOCAL_KEYS.lastMode, JSON.stringify({ mode, under: defaultMode }));
}
