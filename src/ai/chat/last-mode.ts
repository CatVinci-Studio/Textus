import {
  storedAgentMode,
  type AgentMode,
} from "../../settings/SettingsContext";
import { LOCAL_KEYS, readLocalJson, writeLocal } from "../../storage/local";

/**
 * The modes each composer offers, in order. Quick Ask is for a quick change
 * to the passage it was opened on, so it starts on Revise and has no Write;
 * the panel and the detached window have all three.
 */
export const COMPOSER_MODES: Record<"full" | "quick", readonly AgentMode[]> = {
  full: ["write", "review", "revise"],
  quick: ["revise", "review"],
};

/** `mode` where the composer offers it, else the composer's first mode - a
 *  remembered or default Write in Quick Ask starts on Revise. */
export function fitMode(
  mode: AgentMode,
  offered: readonly AgentMode[],
): AgentMode {
  return offered.includes(mode) ? mode : offered[0];
}

/**
 * The panel's mode carries over: a new conversation and the detached window
 * used to start back in the Settings default (Review) right after the user
 * had switched to Revise. The pick is kept with the default it was made under, so
 * changing the default in Settings still takes effect. Shared through
 * localStorage, which the detached window sees too.
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
