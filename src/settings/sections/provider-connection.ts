import { useCallback, useEffect, useMemo, useState } from "react";
import type { Strings, TextKey } from "../../i18n/strings";
import type { ProviderCatalogEntry } from "../../ai/provider-catalog";
import { auth } from "../../platform/ipc";
import type { AiProvider } from "../SettingsContext";

/** Whether each AI provider is connected (by account, key or custom
 *  endpoint), and its name as Settings shows it. */

// The catalog's labels are brand names, the same in every language - except
// these: "custom" is a description, Doubao is known in Chinese by its
// Chinese name, and MiniMax's two platforms are told apart in words.
const LOCALIZED_LABELS: Partial<Record<string, TextKey>> = {
  custom: "providerCustom",
  doubao: "providerDoubao",
  minimax: "providerMiniMax",
  "minimax-intl": "providerMiniMaxIntl",
};

export function localizedLabel(
  entry: ProviderCatalogEntry,
  t: Strings,
): string {
  const key = LOCALIZED_LABELS[entry.id];
  return key ? t[key] : entry.label;
}

/// Normalizes each provider's differently shaped "is it connected" check to
/// one boolean per auth method.
export async function fetchConnected(
  entry: ProviderCatalogEntry,
): Promise<{ oauth: boolean; apiKey: boolean }> {
  if (entry.id === "custom") {
    const config = await auth.customEndpointStatus();
    return { oauth: false, apiKey: config !== null };
  }
  const oauth = entry.auth.includes("oauth")
    ? (await auth.oauthStatus(entry.id)).configured
    : false;
  const apiKey = entry.auth.includes("api_key")
    ? entry.keyOptional || (await auth.providerApiKeyStatus(entry.id))
    : false;
  return { oauth, apiKey };
}

export interface ConnectedState {
  oauth: boolean;
  apiKey: boolean;
}

/** Each catalog provider's connection, checked as the catalog loads and
 *  after a sign-in changes; the selected one's is also reported. */
export function useConnectedProviders(
  catalog: ProviderCatalogEntry[],
  activeId: AiProvider,
  onActiveConnectedChange?: (connected: boolean) => void,
) {
  const [connected, setConnected] = useState<
    Partial<Record<AiProvider, ConnectedState>>
  >({});

  const refreshConnected = useCallback((entry: ProviderCatalogEntry) => {
    fetchConnected(entry)
      .then((state) => setConnected((prev) => ({ ...prev, [entry.id]: state })))
      .catch(() => {});
  }, []);

  useEffect(() => {
    for (const entry of catalog) refreshConnected(entry);
  }, [catalog, refreshConnected]);

  const activeConnected = connected[activeId];
  const isConnected = !!(activeConnected?.oauth || activeConnected?.apiKey);
  useEffect(() => {
    onActiveConnectedChange?.(isConnected);
  }, [isConnected, onActiveConnectedChange]);

  return { connected, refreshConnected, isConnected };
}

/** The provider list's search: the query typed and the providers whose
 *  name (as shown) or id holds it. */
export function useProviderSearch(catalog: ProviderCatalogEntry[], t: Strings) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (e) => localizedLabel(e, t).toLowerCase().includes(q) || e.id.includes(q),
    );
  }, [catalog, query, t]);
  return { query, setQuery, filtered };
}
