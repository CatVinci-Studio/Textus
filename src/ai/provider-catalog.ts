import { useEffect, useState } from "react";
import { ai, type WebSearchStatus } from "../platform/ipc";
import { useSettings } from "../settings/SettingsContext";

/**
 * Structural facts about each AI provider, fetched from the Rust catalog
 * (src-tauri/src/ai/catalog.rs - fields kept in sync by hand, comments on
 * both sides point here) so the provider picker in Settings doesn't
 * hardcode the same facts a second time. Provider ids are plain strings now
 * (not a closed union) - the catalog itself is the source of truth for
 * which ones exist.
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
  /** Whether this provider's API accepts image content parts at all - what
   *  gates the chat's image attachments. A provider-level claim, not a
   *  model-level one; see the Rust field's comment for why. */
  supportsVision: boolean;
  /** False when a live model-list fetch is known not to work. */
  modelsListable: boolean;
  /** A small pre-supplied set of current model ids (pi.dev's models.json
   *  idea) - seeds the picker before, or in place of, any live fetch. */
  knownModels: string[];
}

function fetchProviderCatalog(): Promise<ProviderCatalogEntry[]> {
  return ai.listProviders();
}

/// A deliberate subset of the Rust catalog (src-tauri/src/ai/catalog.rs) -
/// only for the first render and the dev shim, where
/// `invoke("list_providers")` resolves to `null` instead of the real list.
/// Its entries must still match the Rust ones (provider-catalog.test.ts).
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
    supportsVision: true,
    modelsListable: true,
    knownModels: [],
  },
];

/// The catalog entry for whichever provider is selected in Settings, or
/// undefined while the catalog is still loading and the fallback doesn't
/// carry it.
///
/// For callers that want only the active entry - it saves them wiring up
/// both the catalog and the settings. A component that already holds the
/// catalog for other reasons should keep doing its own `find` instead:
/// calling this as well would subscribe to the catalog twice.
export function useActiveProvider(): ProviderCatalogEntry | undefined {
  const { settings } = useSettings();
  const catalog = useProviderCatalog();
  return catalog.find((entry) => entry.id === settings.aiProvider);
}

/// Shared catalog fetch (fallback -> real list once it resolves) - both the
/// provider picker and the Textus AI page's chat model picker need the same
/// data, so this is the one place that owns fetching it.
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

/** Fired when a search service's key is saved or cleared - a key isn't a
 *  setting, so useWebSearchStatus wouldn't otherwise ask again. */
const WEB_SEARCH_SETUP = "textus:web-search-setup";

export function notifyWebSearchSetup() {
  window.dispatchEvent(new Event(WEB_SEARCH_SETUP));
}

/// What the composer's Web search button can do with the chat provider and
/// model chosen in Settings: the provider's own search, or the search
/// service Textus uses instead (src-tauri ai/web/mod.rs decides). Null
/// until it is known.
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
