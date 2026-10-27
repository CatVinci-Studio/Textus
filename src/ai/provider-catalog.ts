import { useEffect, useState } from "react";
import { ai, type WebSearchStatus } from "../platform/ipc";
import { useSettings } from "../prefs/SettingsContext";

/**
 * Structural facts about each AI provider, fetched from the backend catalog
 * so Settings doesn't hardcode them a second time. Fields kept in step by hand.
 */
export interface ProviderCatalogEntry {
  id: string;
  label: string;
  dialect:
    "openai-responses" | "anthropic-messages" | "openai-chat-completions";
  /** Auth methods this provider supports, in preference order. */
  auth: ("oauth" | "api_key" | "custom")[];
  baseUrl: string | null;
  /** Low-cost default shared by completion and grammar checking. */
  defaultModel: string | null;
  /** Stronger default used only by Agent chat. */
  agentDefaultModel: string | null;
  keyOptional: boolean;
  /** Its account sign-in isn't one the provider offers other apps. */
  oauthUnofficial: boolean;
  /** Whether the provider's API accepts image parts at all, which gates the
   *  chat's image attachments. A provider-level claim, not a model-level one. */
  supportsVision: boolean;
  /** False when a live model-list fetch is known not to work. */
  modelsListable: boolean;
  /** A few current model ids that seed the picker before, or instead of, a live fetch. */
  knownModels: string[];
}

function fetchProviderCatalog(): Promise<ProviderCatalogEntry[]> {
  return ai.listProviders();
}

/// A subset of the backend catalog for the first render and the dev shim,
/// where `list_providers` resolves to null. Entries must match the backend's.
export const FALLBACK_CATALOG: ProviderCatalogEntry[] = [
  {
    id: "openai",
    label: "OpenAI",
    dialect: "openai-responses",
    auth: ["oauth", "api_key"],
    baseUrl: null,
    defaultModel: "gpt-6-luna",
    agentDefaultModel: "gpt-6.1-sol",
    keyOptional: false,
    oauthUnofficial: false,
    supportsVision: true,
    modelsListable: true,
    knownModels: ["gpt-6.1-sol", "gpt-6-luna"],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    dialect: "anthropic-messages",
    auth: ["oauth", "api_key"],
    baseUrl: null,
    defaultModel: "claude-haiku-5-5",
    agentDefaultModel: "claude-sonnet-5-5",
    keyOptional: false,
    oauthUnofficial: true,
    supportsVision: true,
    modelsListable: true,
    knownModels: ["claude-sonnet-5-5", "claude-haiku-5-5"],
  },
  {
    id: "custom",
    label: "Custom Endpoint",
    dialect: "openai-chat-completions",
    auth: ["custom"],
    baseUrl: null,
    defaultModel: null,
    agentDefaultModel: null,
    keyOptional: true,
    oauthUnofficial: false,
    supportsVision: true,
    modelsListable: true,
    knownModels: [],
  },
];

/// The catalog entry for the provider selected in Settings, or undefined while
/// loading. A component that already holds the catalog should `find` itself
/// rather than subscribe twice.
export function useActiveProvider(): ProviderCatalogEntry | undefined {
  const { settings } = useSettings();
  const catalog = useProviderCatalog();
  return catalog.find((entry) => entry.id === settings.aiProvider);
}

/// The shared catalog fetch: the fallback, then the real list once it resolves.
export function useProviderCatalog(): ProviderCatalogEntry[] {
  const [catalog, setCatalog] =
    useState<ProviderCatalogEntry[]>(FALLBACK_CATALOG);

  useEffect(() => {
    fetchProviderCatalog()
      .then((list) => {
        if (list?.length) setCatalog(list);
      })
      .catch(() => {});
  }, []);

  return catalog;
}

/** Fired when a search service's key is saved or cleared; a key isn't a
 *  setting, so nothing else would ask again. */
const WEB_SEARCH_SETUP = "textus:web-search-setup";

export function notifyWebSearchSetup() {
  window.dispatchEvent(new Event(WEB_SEARCH_SETUP));
}

/// What the composer's Web search button can do with the chosen chat provider
/// and model: its own search, or Textus's search service. Null until known.
export function useWebSearchStatus(): WebSearchStatus | null {
  const { settings } = useSettings();
  const provider = settings.aiProvider;
  const model = settings.agentModels[provider] || null;
  const { searchService, searxngUrl } = settings;
  const [status, setStatus] = useState<WebSearchStatus | null>(null);
  const [setups, setSetups] = useState(0);
  useEffect(() => {
    const bump = () => setSetups((n) => n + 1);
    window.addEventListener(WEB_SEARCH_SETUP, bump);
    return () => window.removeEventListener(WEB_SEARCH_SETUP, bump);
  }, []);
  useEffect(() => {
    let live = true;
    ai.webSearchStatus(provider, model, searchService, searxngUrl)
      .then((s) => {
        if (live) setStatus(s);
      })
      .catch(() => {
        if (live) setStatus(null);
      });
    return () => {
      live = false;
    };
  }, [provider, model, searchService, searxngUrl, setups]);
  return status;
}
