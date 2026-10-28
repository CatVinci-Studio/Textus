import { Channel } from "@tauri-apps/api/core";
import type { ImageHost } from "../prefs/SettingsContext";
import type { CustomEndpointStatus_Serialize } from "./bindings/auth";
import { aiCommand, command } from "./ipc-call";

/** Backend commands for signing in: AI providers, custom endpoints, picture hosts. */

/** What every sign-in's status command answers (more, for some). */
export interface OauthStatus {
  configured: boolean;
}

/** What custom_endpoint_status reports. The key itself never comes back
 *  (`api_key` is always null), only `has_api_key`. */
export type CustomEndpointConfig = CustomEndpointStatus_Serialize;

/** Provider ids with an OAuth flow and their command names, looked up by
 *  provider id as the picker iterates the catalog. */
export const OAUTH_COMMANDS: Record<
  string,
  {
    status: "codex_auth_status" | "claude_auth_status";
    login: "codex_login" | "claude_login";
    logout: "codex_logout" | "claude_logout";
  }
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
  oauthStatus: (providerId: string): Promise<OauthStatus> =>
    command(OAUTH_COMMANDS[providerId].status),
  /** Signs in through the browser. `onUrl` gets the sign-in page's URL as
   *  the browser is asked to open it, for when it doesn't open. */
  oauthLogin: (providerId: string, onUrl?: (url: string) => void) => {
    const channel = new Channel<string>();
    if (onUrl) channel.onmessage = onUrl;
    return command(OAUTH_COMMANDS[providerId].login, channel);
  },
  oauthLogout: (providerId: string) =>
    command(OAUTH_COMMANDS[providerId].logout),

  providerApiKeyStatus: (provider: string) =>
    command("provider_api_key_status", provider),
  setProviderApiKey: (provider: string, key: string) =>
    command("set_provider_api_key", provider, key),
  clearProviderApiKey: (provider: string) =>
    command("clear_provider_api_key", provider),

  customEndpointStatus: () => command("custom_endpoint_status"),
  setCustomEndpoint: (baseUrl: string, apiKey: string | null, model: string) =>
    command("set_custom_endpoint", baseUrl, apiKey, model),
  clearCustomEndpoint: () => command("clear_custom_endpoint"),
  fetchCustomModels: (baseUrl: string, apiKey: string | null) =>
    aiCommand("fetch_custom_models", baseUrl, apiKey),
  testCustomEndpoint: (baseUrl: string, apiKey: string | null) =>
    aiCommand("test_custom_endpoint", baseUrl, apiKey),
};

/** Image-host credentials in the provider-key store, one per host under a
 *  reserved id never shown as a provider. Keep in step with the Rust side. */
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
