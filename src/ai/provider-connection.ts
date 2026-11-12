import { useCallback, useEffect, useState } from "react";
import type { Strings, TextKey } from "../i18n/strings";
import type { ProviderCatalogEntry } from "./provider-catalog";
import { auth } from "../platform/ipc";
import type { AiProvider } from "../prefs/SettingsContext";

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
async function fetchConnected(
  entry: ProviderCatalogEntry,
): Promise<{ oauth: boolean; apiKey: boolean }> {
  if (entry.id === "custom") {
    const config = await auth.customEndpointStatus();
    return { oauth: false, apiKey: config !== null };
  }
  // Checked apart, so a sign-in that can't be read doesn't hide a saved key.
  const [oauth, apiKey] = await Promise.all([
    entry.auth.includes("oauth")
      ? auth
          .oauthStatus(entry.id)
          .then((s) => s.configured)
          .catch(() => false)
      : false,
    entry.auth.includes("api_key")
      ? entry.keyOptional || auth.providerApiKeyStatus(entry.id)
      : false,
  ]);
  return { oauth, apiKey };
}

export interface ConnectedState {
  oauth: boolean;
  apiKey: boolean;
}

/** Each catalog provider's connection, checked as the catalog loads and
 *  after a sign-in changes (not while `check` is off: Settings drawn only
 *  for its search); the selected one's is also reported. */
export function useConnectedProviders(
  catalog: readonly ProviderCatalogEntry[],
  activeId: AiProvider,
  onActiveConnectedChange?: (connected: boolean) => void,
  check = true,
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
    if (check) for (const entry of catalog) refreshConnected(entry);
  }, [catalog, refreshConnected, check]);

  const activeConnected = connected[activeId];
  const isConnected = !!(activeConnected?.oauth || activeConnected?.apiKey);
  useEffect(() => {
    onActiveConnectedChange?.(isConnected);
  }, [isConnected, onActiveConnectedChange]);

  return { connected, refreshConnected, isConnected };
}
