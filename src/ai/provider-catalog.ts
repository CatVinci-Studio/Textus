import { useEffect, useMemo, useState } from "react";
import { ai, type WebSearchStatus } from "../platform/ipc";
import { useSettings, useSettingsIfAny } from "../prefs/SettingsContext";
import { PROVIDER_CATALOG } from "../platform/bindings/ai";
import { chosenModel } from "./chosen-model";
import { createSubscribers } from "../utils/store";
import {
  useCustomEndpoints,
  useFollowEndpointChoices,
  withCustomEndpoints,
} from "./custom-endpoints";

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

/// The providers, in the catalog's order, each saved custom endpoint one of
/// them. The same array while the endpoints are: lists of providers are
/// effect dependencies.
export function useProviderCatalog(): readonly ProviderCatalogEntry[] {
  const endpoints = useCustomEndpoints();
  useFollowEndpointChoices(useSettingsIfAny()?.settings.agentModels ?? {});
  return useMemo(() => withCustomEndpoints(CATALOG, endpoints), [endpoints]);
}

/** Fired when a search service's key is saved or cleared; a key isn't a
 *  setting, so nothing else would ask again. */
const searchSetups = createSubscribers();

export const notifyWebSearchSetup = searchSetups.publish;

/// What the composer's Web search button can do with the chosen chat provider
/// and model: its own search, or Textus's search service. Null until known.
export function useWebSearchStatus(): WebSearchStatus | null {
  const { settings } = useSettings();
  const provider = settings.aiProvider;
  const model = chosenModel(settings);
  const { searchService, searxngUrl } = settings;
  const [status, setStatus] = useState<WebSearchStatus | null>(null);
  const [setups, setSetups] = useState(0);
  useEffect(() => {
    return searchSetups.subscribe(() => setSetups((n) => n + 1));
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
