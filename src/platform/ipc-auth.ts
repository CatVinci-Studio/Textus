import { Channel } from "@tauri-apps/api/core";
import type { ImageHost } from "../settings/SettingsContext";
import { aiCall, call } from "./ipc-call";

/**
 * Backend commands for signing in: AI providers by OAuth or key, custom
 * endpoints, and picture hosts (ipc.ts).
 */

export interface OauthStatus {
  configured: boolean;
}

/** What custom_endpoint_status reports (src-tauri/src/auth/custom_endpoint.rs
 *  CustomEndpointStatus). The key itself never comes back to the webview -
 *  `api_key` is always null - only whether one is stored. */
export interface CustomEndpointConfig {
  base_url: string;
  api_key: string | null;
  /** A key is saved for `base_url`: saving or testing with the key field
   *  left empty uses it (for that URL only), and Clear removes it. */
  has_api_key: boolean;
  model: string;
}

/** Provider ids with an OAuth flow and their command names - dynamic
 *  dispatch (not a fixed per-provider function) because the picker iterates
 *  the catalog and looks these up by provider id. */
export const OAUTH_COMMANDS: Record<
  string,
  { status: string; login: string; logout: string }
> = {
  openai: {
    status: "codex_auth_status",
    login: "codex_login",
    logout: "codex_logout",
  },
  anthropic: {
    status: "claude_auth_status",
    login: "claude_login",
    logout: "claude_logout",
  },
};

export const auth = {
  oauthStatus: (providerId: string) =>
    call<OauthStatus>(OAUTH_COMMANDS[providerId].status),
  /** Signs in through the browser. `onUrl` gets the sign-in page's URL as
   *  the browser is asked to open it, for when it doesn't open. */
  oauthLogin: (providerId: string, onUrl?: (url: string) => void) => {
    const channel = new Channel<string>();
    if (onUrl) channel.onmessage = onUrl;
    return call<OauthStatus>(OAUTH_COMMANDS[providerId].login, {
      onUrl: channel,
    });
  },
  oauthLogout: (providerId: string) =>
    call<void>(OAUTH_COMMANDS[providerId].logout),

  providerApiKeyStatus: (provider: string) =>
    call<boolean>("provider_api_key_status", { provider }),
  setProviderApiKey: (provider: string, key: string) =>
    call<void>("set_provider_api_key", { provider, key }),
  clearProviderApiKey: (provider: string) =>
    call<void>("clear_provider_api_key", { provider }),

  customEndpointStatus: () =>
    call<CustomEndpointConfig | null>("custom_endpoint_status"),
  setCustomEndpoint: (baseUrl: string, apiKey: string | null, model: string) =>
    call<void>("set_custom_endpoint", { baseUrl, apiKey, model }),
  clearCustomEndpoint: () => call<void>("clear_custom_endpoint"),
  fetchCustomModels: (baseUrl: string, apiKey: string | null) =>
    aiCall<string[]>("fetch_custom_models", { baseUrl, apiKey }),
  testCustomEndpoint: (baseUrl: string, apiKey: string | null) =>
    aiCall<void>("test_custom_endpoint", { baseUrl, apiKey }),
};

/** Image-host credentials reuse the same private 0600 credential store as
 * provider keys, one per host under a reserved id that is never shown as
 * an AI provider. Mirrors `ImageHost::credential_id` in
 * src-tauri/src/commands/image_host.rs. */
export const IMAGE_HOST_CREDENTIAL_IDS: Record<ImageHost, string> = {
  picgo: "__image_host_picgo",
  smms: "__image_host_smms",
  imgur: "__image_host_imgur",
  custom: "__image_host",
};
export const imageHostAuth = {
  tokenStatus: (host: ImageHost) =>
    auth.providerApiKeyStatus(IMAGE_HOST_CREDENTIAL_IDS[host]),
  setToken: (host: ImageHost, token: string) =>
    auth.setProviderApiKey(IMAGE_HOST_CREDENTIAL_IDS[host], token),
  clearToken: (host: ImageHost) =>
    auth.clearProviderApiKey(IMAGE_HOST_CREDENTIAL_IDS[host]),
};

// ---------------------------------------------------------------------------
// ai (src-tauri/src/ai/*.rs)
// ---------------------------------------------------------------------------
