import { LOCAL_KEYS, readLocalJson, writeLocal } from "../storage/local";
import snapshot from "./models-snapshot.json";

/** What models.dev says about one model (scripts/sync-models.mjs keeps the
 *  bundled snapshot current). Absent for models it doesn't list - those
 *  show as a bare id. */
export interface ModelInfo {
  name: string;
  released: string | null;
  tools: boolean;
  vision: boolean;
  context: number | null;
  status?: string;
}

type Snapshot = {
  providers: Record<string, { models: Record<string, ModelInfo> }>;
};

export function modelInfo(provider: string, id: string): ModelInfo | null {
  return (snapshot as Snapshot).providers[provider]?.models[id] ?? null;
}

/** "1M", "200K" - context windows as people quote them. */
export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000)
    return `${Math.round((tokens / 1_000_000) * 10) / 10}M`;
  return `${Math.round(tokens / 1000)}K`;
}

export interface FetchedModels {
  models: string[];
  /** Epoch ms. */
  at: number;
}

/** A provider's last fetched model list, so the picker keeps it across
 *  restarts instead of offering only the defaults until fetched again. */
export function readFetchedModels(provider: string): FetchedModels | null {
  const parsed = readLocalJson(LOCAL_KEYS.fetchedModels(provider)) as {
    models?: unknown;
    at?: unknown;
  } | null;
  return Array.isArray(parsed?.models) && typeof parsed.at === "number"
    ? {
        models: parsed.models.filter((m): m is string => typeof m === "string"),
        at: parsed.at,
      }
    : null;
}

export function writeFetchedModels(provider: string, models: string[]): void {
  writeLocal(
    LOCAL_KEYS.fetchedModels(provider),
    JSON.stringify({ models, at: Date.now() }),
  );
}

/** Fetched ids ordered for the picker: current models before deprecated
 *  ones, each group keeping the provider's (newest-first) order. */
export function orderForPicker(provider: string, ids: string[]): string[] {
  const deprecated = (id: string) =>
    modelInfo(provider, id)?.status === "deprecated";
  return [...ids.filter((id) => !deprecated(id)), ...ids.filter(deprecated)];
}
