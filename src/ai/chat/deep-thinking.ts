import { useEffect, useState } from "react";
import { ai } from "../../platform/ipc";
import { useSettings } from "../../settings/SettingsContext";
import {
  LOCAL_KEYS,
  readLocal,
  removeLocal,
  writeLocal,
} from "../../storage/local";

/**
 * Deep thinking stays on once pressed, across messages, conversations and the
 * detached window, until pressed again. The composer's button is its only
 * control.
 */
export function deepThinkingOn(): boolean {
  return readLocal(LOCAL_KEYS.deepThinking) === "1";
}

/** Not kept when storage refuses it: the next composer starts with it off. */
export function rememberDeepThinking(on: boolean): void {
  if (on) writeLocal(LOCAL_KEYS.deepThinking, "1");
  else removeLocal(LOCAL_KEYS.deepThinking);
}

/**
 * Whether Deep thinking would change anything for the provider and model in
 * use. False until it answers, so the button appears rather than disappears.
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
