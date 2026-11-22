import { useState } from "react";
import type { CustomEndpointConfig } from "../../platform/ipc";
import { DEFAULT_SETTINGS, type Settings } from "../../prefs/settings-types";
import { useFetchedModels } from "../../ai/model-info";

/** What a custom endpoint's panel is editing: its fields as typed. */
export interface EndpointForm {
  name: string;
  baseUrl: string;
  /** Empty: the saved key, while the URL is the one it was saved with. */
  apiKey: string;
  model: string;
}

/** The fields, starting from the saved endpoint (none for a new one). The
 *  key never comes back from the backend, so its field starts empty. */
export function useEndpointForm(endpoint?: CustomEndpointConfig) {
  const [form, setForm] = useState<EndpointForm>({
    name: endpoint?.name ?? "",
    baseUrl: endpoint?.base_url ?? "",
    apiKey: "",
    model: endpoint?.model ?? "",
  });
  const set = (patch: Partial<EndpointForm>) =>
    setForm((was) => ({ ...was, ...patch }));
  // A new endpoint has no id to keep its list under until it is saved.
  const [listed, setListed] = useState<string[] | null>(null);
  const saved = useFetchedModels(endpoint?.id ?? "").models;
  const models = listed ?? (endpoint ? saved : []);
  return { form, set, models, setListed };
}

/** Whether two base URLs name the same endpoint, by the backend's rule for
 *  sending a stored key to a URL. */
export function sameEndpoint(a: string, b: string): boolean {
  const norm = (url: string) => url.trim().replace(/\/+$/, "");
  return norm(a) === norm(b);
}

/** The settings once endpoint `id` is removed: nothing still chooses it,
 *  and its chosen models go with it. */
export function settingsWithout(
  settings: Pick<
    Settings,
    "aiProvider" | "writingProvider" | "agentModels" | "writingModels"
  >,
  id: string,
): Partial<Settings> {
  const drop = (models: Record<string, string>) =>
    Object.fromEntries(Object.entries(models).filter(([key]) => key !== id));
  return {
    agentModels: drop(settings.agentModels),
    writingModels: drop(settings.writingModels),
    ...(settings.aiProvider === id && {
      aiProvider: DEFAULT_SETTINGS.aiProvider,
    }),
    ...(settings.writingProvider === id && { writingProvider: "" }),
  };
}
