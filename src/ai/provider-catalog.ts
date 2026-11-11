import { useEffect, useState } from "react";
import { ai, type WebSearchStatus } from "../platform/ipc";
import { useSettings } from "../prefs/SettingsContext";
import { PROVIDER_CATALOG } from "../platform/bindings/ai";

/** Structural facts about each AI provider, as the backend's catalog
 *  (ai/catalog.rs) has them, generated with the bindings. */
export interface ProviderCatalogEntry {
  id: string;
  label: string;
  dialect: string;
  auth: readonly string[];
  baseUrl: string | null;
  defaultModel: string | null;
  agentDefaultModel: string | null;
  keyOptional: boolean;
  oauthUnofficial: boolean;
  supportsVision: boolean;
  knownModels: readonly string[];
}

/** The catalog, checked against that shape here. */
const CATALOG: readonly ProviderCatalogEntry[] = PROVIDER_CATALOG;

/// The catalog entry for the provider selected in Settings, or undefined while
/// loading. A component that already holds the catalog should `find` itself
/// rather than subscribe twice.
export function useActiveProvider(): ProviderCatalogEntry | undefined {
  const { settings } = useSettings();
  const catalog = useProviderCatalog();
  return catalog.find((entry) => entry.id === settings.aiProvider);
}

/// The providers, in the catalog's order.
export function useProviderCatalog(): readonly ProviderCatalogEntry[] {
  return CATALOG;
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
