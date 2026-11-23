import { useEffect, useSyncExternalStore } from "react";
import type { Strings, TextKey } from "../i18n/strings";
import {
  useProviderCatalog,
  type ProviderCatalogEntry,
} from "./provider-catalog";
import { auth } from "../platform/ipc";
import type { AiProvider } from "../prefs/SettingsContext";
import { createSubscribers } from "../utils/store";
import { isCustomEntry } from "./custom-endpoints";

/** Whether each AI provider is connected (by account, key or custom
 *  endpoint), and its name as Settings shows it. */

// The catalog's labels are brand names, the same in every language - except
// these: Doubao is known in Chinese by its Chinese name, and MiniMax's two
// platforms are told apart in words. A custom endpoint goes by its own name.
const LOCALIZED_LABELS: Partial<Record<string, TextKey>> = {
  doubao: "providerDoubao",
  minimax: "providerMiniMax",
  "minimax-intl": "providerMiniMaxIntl",
};

export function localizedLabel(
  entry: ProviderCatalogEntry,
  t: Strings,
): string {
  const key = isCustomEntry(entry) ? undefined : LOCALIZED_LABELS[entry.id];
  return key ? t[key] : entry.label;
}

/// Normalizes each provider's differently shaped "is it connected" check to
/// one boolean per auth method.
async function fetchConnected(
  entry: ProviderCatalogEntry,
): Promise<{ oauth: boolean; apiKey: boolean }> {
  // Listed only once saved, so set up.
  if (isCustomEntry(entry)) return { oauth: false, apiKey: true };
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

type Connections = Partial<Record<AiProvider, ConnectedState>>;

// One copy for the whole window: a sign-in made in Settings shows at once
// in the AI panel and the composer.
let connections: Connections = {};
const subscribers = createSubscribers();
const subscribe = subscribers.subscribe;
const snapshot = () => connections;

/** Checks `entry`'s connection again, for everyone showing it. */
function refreshConnected(entry: ProviderCatalogEntry): void {
  fetchConnected(entry)
    .then((state) => {
      connections = { ...connections, [entry.id]: state };
      subscribers.publish();
    })
    .catch(() => {});
}

/** Whether `entry` can take a message: signed in, a key saved, or one
 *  that needs none. */
export function isReady(
  entry: ProviderCatalogEntry,
  state: ConnectedState | undefined,
): boolean {
  return (
    !!(state?.oauth || state?.apiKey) ||
    (!!entry.keyOptional && !isCustomEntry(entry))
  );
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
  const connected = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    if (check) for (const entry of catalog) refreshConnected(entry);
  }, [catalog, check]);

  const activeConnected = connected[activeId];
  const isConnected = !!(activeConnected?.oauth || activeConnected?.apiKey);
  useEffect(() => {
    onActiveConnectedChange?.(isConnected);
  }, [isConnected, onActiveConnectedChange]);

  return { connected, refreshConnected, isConnected };
}

/** Whether `provider`'s account sign-in is kept. */
export function useSignedIn(provider: string): boolean {
  const catalog = useProviderCatalog();
  const entry = catalog.find((e) => e.id === provider);
  const connected = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    if (entry) refreshConnected(entry);
  }, [entry]);
  return !!connected[provider as AiProvider]?.oauth;
}
