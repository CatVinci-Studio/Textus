import { useSyncExternalStore } from "react";
import { LOCAL_KEYS, readLocalJson, writeLocal } from "../storage/local";
import snapshot from "./models-snapshot.json";
import { createSubscribers } from "../utils/store";

/** What models.dev says about one model, from a bundled snapshot. Absent for
 *  models it doesn't list, which show as a bare id. */
interface ModelInfo {
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

interface FetchedModels {
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
  fetchedCount++;
  fetched.publish();
}

// Every picker (Settings' writing and chat rows, the composer) reads the
// new list at once.
const fetched = createSubscribers();
let fetchedCount = 0;
const onFetched = fetched.subscribe;

/** Draws again whenever a model list is fetched; read the lists with
 *  {@link readFetchedModels}. */
export function useModelsFetched(): number {
  return useSyncExternalStore(onFetched, () => fetchedCount);
}

/** The last list fetched for `provider`, remembered across restarts, drawn
 *  again whenever a new one is fetched. */
export function useFetchedModels(provider: string) {
  useModelsFetched();
  const cached = readFetchedModels(provider);
  return { models: cached?.models ?? [], at: cached?.at ?? null };
}

/** Fetched ids ordered for the picker: current models before deprecated
 *  ones, each group keeping the provider's (newest-first) order. */
export function orderForPicker(provider: string, ids: string[]): string[] {
  const deprecated = (id: string) =>
    modelInfo(provider, id)?.status === "deprecated";
  return [...ids.filter((id) => !deprecated(id)), ...ids.filter(deprecated)];
}
