import { emitPluginEvent } from "./app-bridge";

/** What Textus AI is doing, as plugins hear it - never what it says. */
export type AiActivity = "idle" | "thinking" | "writing" | "proposing";

export interface AiState {
  state: AiActivity;
  /** The service and model in use; null before Textus AI is first used. */
  model: { provider: string; id: string | null } | null;
}

let current: AiState = { state: "idle", model: null };

export function aiState(): AiState {
  return current;
}

/** Textus AI's conversation reports each change; plugins hear it once. */
export function reportAiState(
  state: AiActivity,
  provider: string,
  model: string | null,
) {
  const next: AiState = { state, model: { provider, id: model } };
  if (
    next.state === current.state &&
    next.model?.provider === current.model?.provider &&
    next.model?.id === current.model?.id
  )
    return;
  current = next;
  emitPluginEvent("aiState", next);
}
