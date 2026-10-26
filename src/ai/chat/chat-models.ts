import { useSettings } from "../../settings/SettingsContext";
import {
  useProviderCatalog,
  type ProviderCatalogEntry,
} from "../provider-catalog";
import {
  localizedLabel,
  useConnectedProviders,
} from "../../settings/sections/provider-connection";

/** The model a provider's chat uses now: the one chosen for it, else its
 *  default. */
export function chatModel(
  entry: ProviderCatalogEntry,
  chosen: Record<string, string>,
): string {
  return (
    chosen[entry.id] || entry.agentDefaultModel || entry.knownModels[0] || ""
  );
}

/** The models to offer for a provider: the one in use first, then the rest
 *  it lists, each once. */
export function modelChoices(
  entry: ProviderCatalogEntry,
  chosen: Record<string, string>,
): string[] {
  const current = chatModel(entry, chosen);
  return [
    ...new Set([current, entry.agentDefaultModel ?? "", ...entry.knownModels]),
  ].filter(Boolean);
}

/** Whether there is anything to switch to: more than one model across
 *  the providers that are ready. With one, the composer lists no models. */
export function canSwitchModel(
  ready: ProviderCatalogEntry[],
  chosen: Record<string, string>,
): boolean {
  return (
    ready.reduce((n, entry) => n + modelChoices(entry, chosen).length, 0) > 1
  );
}

export interface ModelGroup {
  provider: string;
  label: string;
  models: string[];
}

export interface ChatModels {
  /** The model the next message goes to ("" before Settings has one). */
  model: string;
  provider: string;
  /** The providers ready to use, with their models; empty when there is
   *  nothing to switch to. */
  groups: ModelGroup[];
  /** Sets the chat provider and its model, as Settings does. */
  choose: (provider: string, model: string) => void;
}

/** The composer's models, switched without going to Settings. */
export function useChatModels(): ChatModels {
  const { t, settings, setSettings } = useSettings();
  const catalog = useProviderCatalog();
  const { connected } = useConnectedProviders(catalog, settings.aiProvider);
  const active = catalog.find((e) => e.id === settings.aiProvider);
  const ready = catalog.filter(
    (e) =>
      e.id === settings.aiProvider ||
      connected[e.id]?.oauth ||
      connected[e.id]?.apiKey ||
      (e.keyOptional && e.id !== "custom"),
  );
  const chosen = settings.agentModels;
  return {
    model: active ? chatModel(active, chosen) : "",
    provider: settings.aiProvider,
    groups: canSwitchModel(ready, chosen)
      ? ready.map((entry) => ({
          provider: entry.id,
          label: localizedLabel(entry, t),
          models: modelChoices(entry, chosen),
        }))
      : [],
    choose: (provider, model) =>
      setSettings({
        aiProvider: provider as typeof settings.aiProvider,
        agentModels: { ...chosen, [provider]: model },
      }),
  };
}
