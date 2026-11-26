import { Channel } from "@tauri-apps/api/core";
import type { ImageHost } from "../prefs/SettingsContext";
import type { CustomEndpointStatus } from "./bindings/auth";
import { aiCommand, command } from "./ipc-call";

/** Backend commands for signing in: AI providers, custom endpoints, picture hosts. */

/** What every sign-in's status command answers (more, for some). */
interface OauthStatus {
  configured: boolean;
}

/** One endpoint as custom_endpoints_status reports it (Rust's
 *  `CustomEndpointStatus`). The key itself never comes back, only
 *  `has_api_key`. */
export type CustomEndpointConfig = CustomEndpointStatus;

/** What the settings page saves for an endpoint; `id` null adds one. */
export interface CustomEndpointEdit {
  id: string | null;
  name: string;
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

/** Provider ids with an OAuth flow and their command names, looked up by
 *  provider id as the picker iterates the catalog. */
const OAUTH_COMMANDS: Record<
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

  customEndpointsStatus: () => command("custom_endpoints_status"),
  /** Resolves to the endpoint's id, a new one's too. */
  setCustomEndpoint: (e: CustomEndpointEdit) =>
    command("set_custom_endpoint", e.id, e.name, e.baseUrl, e.apiKey, e.model),
  clearCustomEndpoint: (id: string) => command("clear_custom_endpoint", id),
  fetchCustomModels: (
    id: string | null,
    baseUrl: string,
    apiKey: string | null,
  ) => aiCommand("fetch_custom_models", id, baseUrl, apiKey),
};

/** Image-host tokens, kept in the provider-key store under the id Rust
 *  gives each host. */
const keyOf = (host: ImageHost) => command("image_host_key_id", host);
export const imageHostAuth = {
  tokenStatus: async (host: ImageHost) =>
    auth.providerApiKeyStatus(await keyOf(host)),
  setToken: async (host: ImageHost, token: string) =>
    auth.setProviderApiKey(await keyOf(host), token),
  clearToken: async (host: ImageHost) =>
    auth.clearProviderApiKey(await keyOf(host)),
};
