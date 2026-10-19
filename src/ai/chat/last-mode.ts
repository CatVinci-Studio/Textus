import {
  migrateAgentMode,
  type AgentMode,
} from "../../settings/SettingsContext";

const KEY = "textus-agent-last-mode";

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
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultMode;
    const saved = JSON.parse(raw) as { mode?: unknown; under?: unknown };
    // Kept under 1.0's names ("ask", "edit"), both sides read as today's.
    const mode = migrateAgentMode(saved.mode);
    if (mode && migrateAgentMode(saved.under) === defaultMode) return mode;
  } catch {
    // Unreadable or blocked storage: the default.
  }
  return defaultMode;
}

export function rememberMode(mode: AgentMode, defaultMode: AgentMode): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ mode, under: defaultMode }));
  } catch {
    // Not kept; the next conversation starts at the default.
  }
}
