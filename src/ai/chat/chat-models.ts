import { useSettings } from "../../prefs/SettingsContext";
import {
  useProviderCatalog,
  type ProviderCatalogEntry,
} from "../provider-catalog";
import { readFetchedModels } from "../model-info";
import { localizedLabel, useConnectedProviders } from "../provider-connection";
import { useExternalAgents } from "../../plugins/contributions/agents";
import {
  useAgentOptions,
  type AgentOptionsMenu,
} from "../agents/useAgentOptions";

/** The models menu's group of external agents (plugins' `contributes.agents`). */
export const AGENTS_GROUP = "agents";

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
 *  it lists, each once. One with no list of its own (Ollama: whatever is
 *  installed) offers what was last fetched from it, and the model chosen
 *  there only while it is the provider in use: one since removed isn't
 *  offered. */
export function modelChoices(
  entry: ProviderCatalogEntry,
  chosen: Record<string, string>,
  fetched: string[] = [],
  inUse = true,
): string[] {
  const own = entry.knownModels.length > 0 || !!entry.agentDefaultModel;
  const current = own || inUse ? chatModel(entry, chosen) : "";
  return [
    ...new Set([
      current,
      entry.agentDefaultModel ?? "",
      ...entry.knownModels,
      ...(own ? [] : fetched),
    ]),
  ].filter(Boolean);
}

/** Whether there is anything to switch to: more than one model across
 *  the providers that are ready. With one, the composer lists no models. */
export function canSwitchModel(groups: { models: string[] }[]): boolean {
  return groups.reduce((n, group) => n + group.models.length, 0) > 1;
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
  /** The external agent's own options (mode, model, effort), while one
   *  is in use and has said what it offers. */
  agentOptions?: AgentOptionsMenu | null;
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
  const agents = useExternalAgents();
  const agent = agents.find((a) => a.key === settings.chatAgent);
  const agentOptions = useAgentOptions(agent?.key ?? null);
  // A provider with nothing to offer isn't listed, not even its name.
  const groups = ready
    .map((entry) => ({
      provider: entry.id,
      label: localizedLabel(entry, t),
      models: modelChoices(
        entry,
        chosen,
        readFetchedModels(entry.id)?.models,
        entry.id === settings.aiProvider,
      ),
    }))
    .filter((group) => group.models.length > 0);
  if (agents.length)
    groups.push({
      provider: AGENTS_GROUP,
      label: t.chatAgentsGroup,
      models: agents.map((a) => a.name),
    });
  return {
    model: agent ? agent.name : active ? chatModel(active, chosen) : "",
    provider: agent ? AGENTS_GROUP : settings.aiProvider,
    groups: canSwitchModel(groups) ? groups : [],
    agentOptions,
    choose: (provider, model) =>
      setSettings(
        provider === AGENTS_GROUP
          ? { chatAgent: agents.find((a) => a.name === model)?.key ?? "" }
          : {
              chatAgent: "",
              aiProvider: provider as typeof settings.aiProvider,
              agentModels: { ...chosen, [provider]: model },
            },
      ),
  };
}

/** Whether a message can go anywhere: an agent chosen, or the selected
 *  provider signed in (or needing no key). Null until that is known, so
 *  the panel doesn't flash a sign-in it then takes back. */
export function useAiSignedIn(): boolean | null {
  const { settings } = useSettings();
  const catalog = useProviderCatalog();
  const { connected } = useConnectedProviders(catalog, settings.aiProvider);
  const agents = useExternalAgents();
  if (agents.some((a) => a.key === settings.chatAgent)) return true;
  const active = catalog.find((e) => e.id === settings.aiProvider);
  if (!active) return null;
  if (active.keyOptional && active.id !== "custom") return true;
  const state = connected[active.id];
  return state ? state.oauth || state.apiKey : null;
}
