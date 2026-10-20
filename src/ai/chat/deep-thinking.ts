import { useEffect, useState } from "react";
import { ai } from "../../platform/ipc";
import { useSettings } from "../../settings/SettingsContext";

const KEY = "textus-agent-deep-thinking";

/**
 * Deep thinking stays on once pressed - across messages, conversations and
 * documents, and in the detached window, which shares localStorage - until
 * it is pressed again: a choice about how the user wants to work, not about
 * one message. Not a setting; the composer's button is the only control.
 */
export function deepThinkingOn(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberDeepThinking(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // Not kept; the next composer starts with it off.
  }
}

/**
 * Whether Deep thinking would change anything for the provider and Agent
 * model in use - the capability table's answer (ai.canThinkDeeper), asked
 * again whenever either changes. False until it answers, so the button
 * appears rather than disappears.
 */
export function useCanThinkDeeper(enabled: boolean): boolean {
  const { settings } = useSettings();
  const provider = settings.aiProvider;
  const model = settings.agentModels[provider] || null;
  const key = `${provider}\n${model ?? ""}`;
  const [answer, setAnswer] = useState<{ key: string; can: boolean } | null>(
    null,
  );
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    ai.canThinkDeeper(provider, model)
      .then((can) => !cancelled && setAnswer({ key, can: can === true }))
      .catch(() => !cancelled && setAnswer({ key, can: false }));
    return () => {
      cancelled = true;
    };
  }, [enabled, provider, model, key]);
  return enabled && answer?.key === key && answer.can;
}
