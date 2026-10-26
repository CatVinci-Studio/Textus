import { errorText } from "../../utils/error-text";
import { useEffect, useState } from "react";
import type { Strings } from "../../i18n/strings";
import type { ProviderCatalogEntry } from "../../ai/provider-catalog";
import { auth, type CustomEndpointConfig } from "../../platform/ipc";
import { Select } from "../../ui/Select";
import {
  MaskedKeyInput,
  RowHelp,
  SecretInput,
  VERBATIM_INPUT,
} from "./controls";
import { type ConnectedState, localizedLabel } from "./provider-connection";

/**
 * Signing in to one AI provider: the account and API-key panels, and the
 * custom endpoint's address, key and model (providers.tsx).
 */

/// A provider with one or both of oauth/api_key auth: renders a tab switch
/// when both are available, or just the relevant panel when only one is.
export function ProviderAuthPanel({
  t,
  entry,
  connected,
  onStatusChange,
}: {
  t: Strings;
  entry: ProviderCatalogEntry;
  connected?: ConnectedState;
  onStatusChange: () => void;
}) {
  const hasOauth = entry.auth.includes("oauth");
  const hasApiKey = entry.auth.includes("api_key");
  // Default to whichever method is already connected; oauth otherwise, since
  // it's the richer entitlement and what the backend prefers when both are
  // configured (see ai::route::resolve_openai_auth).
  const [tab, setTab] = useState<"oauth" | "api_key">(() => {
    if (!hasOauth) return "api_key";
    if (!hasApiKey) return "oauth";
    return connected?.apiKey && !connected?.oauth ? "api_key" : "oauth";
  });

  const label = localizedLabel(entry, t);

  return (
    <div>
      {hasOauth && hasApiKey && (
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab${tab === "oauth" ? " auth-tab-active" : ""}`}
            onClick={() => setTab("oauth")}
          >
            {t.authTabAccount}
          </button>
          <button
            type="button"
            className={`auth-tab${tab === "api_key" ? " auth-tab-active" : ""}`}
            onClick={() => setTab("api_key")}
          >
            {t.authTabApiKey}
          </button>
        </div>
      )}
      {hasOauth && (!hasApiKey || tab === "oauth") && (
        <OauthPanel
          t={t}
          providerId={entry.id}
          label={label}
          unofficial={entry.oauthUnofficial}
          onStatusChange={onStatusChange}
        />
      )}
      {hasApiKey && (!hasOauth || tab === "api_key") && (
        <ApiKeyProviderPanel
          t={t}
          providerId={entry.id}
          label={label}
          keyOptional={entry.keyOptional}
          onStatusChange={onStatusChange}
        />
      )}
    </div>
  );
}

export function OauthPanel({
  t,
  providerId,
  label,
  unofficial = false,
  onStatusChange,
}: {
  t: Strings;
  providerId: string;
  label: string;
  /** Not a sign-in the provider offers other apps: said under it. */
  unofficial?: boolean;
  onStatusChange?: (configured: boolean) => void;
}) {
  const [configured, setConfiguredState] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  // The sign-in page's address, shown while signing in: some machines open
  // no browser (no default set, a sandbox, a remote desktop), and then this
  // is the only way in. Opened on the same computer - the sign-in comes
  // back to it.
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setConfigured = (ok: boolean) => {
    setConfiguredState(ok);
    onStatusChange?.(ok);
  };

  useEffect(() => {
    auth
      .oauthStatus(providerId)
      .then((s) => setConfigured(s.configured))
      .catch(() => {});
    // onStatusChange identity isn't expected to change per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  async function login() {
    setLoggingIn(true);
    setError(null);
    setLoginUrl(null);
    setCopied(false);
    try {
      const status = await auth.oauthLogin(providerId, setLoginUrl);
      setConfigured(status.configured);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoggingIn(false);
      setLoginUrl(null);
    }
  }

  async function logout() {
    await auth.oauthLogout(providerId);
    setConfigured(false);
  }

  return (
    <div>
      {error && <div className="settings-error">{error}</div>}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">
            {t.accountLabelTemplate.replace("{name}", label)}
          </div>
          <div className="settings-row-hint">
            {loggingIn
              ? t.loggingIn
              : configured
                ? t.accountConnectedAs
                : t.accountNotConnected}
          </div>
          {unofficial && (
            <div className="settings-row-hint settings-signin-unofficial">
              {t.signInUnofficial.replace("{name}", label)}
            </div>
          )}
        </div>
        {configured ? (
          <button
            className="text-button settings-inline-button"
            onClick={logout}
          >
            {t.logoutButton}
          </button>
        ) : (
          <button
            className="text-button settings-inline-button"
            onClick={login}
            disabled={loggingIn}
          >
            {t.signInTemplate.replace("{name}", label)}
          </button>
        )}
      </div>
      {loggingIn && loginUrl && (
        <div className="settings-row settings-login-link">
          <div>
            <div className="settings-row-hint">{t.loginLinkHint}</div>
            <code className="settings-login-url">{loginUrl}</code>
          </div>
          <button
            className="text-button settings-inline-button"
            onClick={() => {
              void navigator.clipboard
                .writeText(loginUrl)
                .then(() => setCopied(true));
            }}
          >
            {copied ? t.loginLinkCopied : t.loginLinkCopy}
          </button>
        </div>
      )}
    </div>
  );
}

export function ApiKeyProviderPanel({
  t,
  providerId,
  label,
  keyOptional = false,
  onStatusChange,
}: {
  t: Strings;
  providerId: string;
  label: string;
  keyOptional?: boolean;
  onStatusChange?: (configured: boolean) => void;
}) {
  const [configured, setConfiguredState] = useState(false);
  const [input, setInput] = useState("");

  const setConfigured = (ok: boolean) => {
    setConfiguredState(ok);
    onStatusChange?.(ok);
  };

  useEffect(() => {
    auth.providerApiKeyStatus(providerId).then(setConfigured);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  async function save() {
    if (!input.trim()) return;
    await auth.setProviderApiKey(providerId, input.trim());
    setInput("");
    setConfigured(true);
  }

  async function clear() {
    await auth.clearProviderApiKey(providerId);
    setConfigured(false);
  }

  return (
    <div>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">
            {t.apiKeyLabelTemplate.replace("{name}", label)}
            {keyOptional && (
              <RowHelp label={t.apiKeyLabelTemplate.replace("{name}", label)}>
                {t.apiKeyOptionalHintTemplate.replace("{name}", label)}
              </RowHelp>
            )}
          </div>
        </div>
        <SecretInput
          t={t}
          label={t.apiKeyLabelTemplate.replace("{name}", label)}
          saved={configured}
          value={input}
          onChange={setInput}
          onSave={save}
          onClear={clear}
        />
      </div>
    </div>
  );
}

/** Whether two base URLs name the same endpoint - the rule the backend's
 *  same_endpoint (auth/custom_endpoint.rs) uses to decide that a stored key
 *  may go to a URL. */
export function sameEndpoint(a: string, b: string): boolean {
  const norm = (url: string) => url.trim().replace(/\/+$/, "");
  return norm(a) === norm(b);
}

export function CustomProviderPanel({
  t,
  onStatusChange,
}: {
  t: Strings;
  onStatusChange?: (configured: boolean) => void;
}) {
  const [config, setConfig] = useState<CustomEndpointConfig | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "ok" | "error">(
    "idle",
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    auth.customEndpointStatus().then((c) => {
      if (c) {
        setConfig(c);
        setBaseUrl(c.base_url);
        // The key never comes back (only `has_api_key`): the empty field
        // says it's saved, in its placeholder.
        setApiKey("");
        setSelectedModel(c.model);
        onStatusChange?.(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchModels() {
    setStatus("checking");
    setStatusMessage(null);
    try {
      const list = await auth.fetchCustomModels(baseUrl, apiKey.trim() || null);
      setModels(list);
      setStatus("ok");
      if (!selectedModel && list.length > 0) setSelectedModel(list[0]);
    } catch (err) {
      setStatus("error");
      setStatusMessage(errorText(err));
    }
  }

  async function testConnection() {
    setStatus("checking");
    setStatusMessage(null);
    try {
      await auth.testCustomEndpoint(baseUrl, apiKey.trim() || null);
      setStatus("ok");
      setStatusMessage(t.customTestSuccess);
    } catch (err) {
      setStatus("error");
      setStatusMessage(errorText(err));
    }
  }

  // An empty key field means "the saved key" to every action here (the
  // backend fills it in) - but only while the URL is the one it was saved
  // with: edited to another host, the old key is not sent, so the field
  // must not claim one either.
  const keySaved =
    !!config?.has_api_key && sameEndpoint(config.base_url, baseUrl);

  async function save() {
    if (!baseUrl.trim() || !selectedModel.trim()) return;
    const typed = apiKey.trim();
    await auth.setCustomEndpoint(
      baseUrl.trim(),
      typed || null,
      selectedModel.trim(),
    );
    setConfig({
      base_url: baseUrl.trim(),
      api_key: null,
      has_api_key: !!typed || keySaved,
      model: selectedModel.trim(),
    });
    // Like the provider keys: once saved, the key leaves the field.
    setApiKey("");
    onStatusChange?.(true);
  }

  async function clear() {
    await auth.clearCustomEndpoint();
    setConfig(null);
    setBaseUrl("");
    setApiKey("");
    setSelectedModel("");
    setModels([]);
    setStatus("idle");
    onStatusChange?.(false);
  }

  return (
    <div>
      {statusMessage && (
        <div
          className={status === "error" ? "settings-error" : "settings-success"}
        >
          {statusMessage}
        </div>
      )}
      <div className="settings-field">
        <label className="settings-field-label">{t.customBaseUrlLabel}</label>
        <input
          type="text"
          inputMode="url"
          {...VERBATIM_INPUT}
          className="settings-text-input"
          placeholder={t.customBaseUrlPlaceholder}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </div>
      <div className="settings-field">
        <label className="settings-field-label">{t.customApiKeyLabel}</label>
        <MaskedKeyInput
          className="settings-text-input"
          label={t.customApiKeyLabel}
          placeholder={keySaved ? t.customApiKeySaved : t.apiKeyPlaceholder}
          value={apiKey}
          onChange={setApiKey}
        />
      </div>
      <div className="settings-field">
        <label className="settings-field-label">{t.customModelLabel}</label>
        <div className="custom-model-row">
          {models.length > 0 ? (
            <Select
              className="settings-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          ) : (
            <input
              type="text"
              {...VERBATIM_INPUT}
              className="settings-text-input"
              placeholder={t.customModelPlaceholder}
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            />
          )}
          <button
            className="text-button settings-inline-button"
            onClick={fetchModels}
            disabled={!baseUrl.trim()}
          >
            {t.customFetchModels}
          </button>
        </div>
      </div>
      <div className="custom-actions-row">
        <button
          className="text-button settings-inline-button"
          onClick={testConnection}
          disabled={!baseUrl.trim()}
        >
          {t.customTestConnection}
        </button>
        <button
          className="text-button settings-inline-button"
          onClick={save}
          disabled={!baseUrl.trim() || !selectedModel.trim()}
        >
          {t.customSave}
        </button>
        {config && (
          <button
            className="text-button settings-inline-button"
            onClick={clear}
          >
            {t.apiKeyClear}
          </button>
        )}
      </div>
    </div>
  );
}
