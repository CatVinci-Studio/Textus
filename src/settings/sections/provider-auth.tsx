import { Segmented } from "../../engine/controls/Segmented";
import { fill } from "../../i18n/fill";
import { useCallback, useEffect, useState } from "react";
import { useLatest } from "../../utils/hooks/useLatest";
import type { Strings } from "../../i18n/strings";
import type { ProviderCatalogEntry } from "../../ai/provider-catalog";
import { auth } from "../../platform/ipc";
import { RowHelp, SecretInput, SettingRow, VERBATIM_INPUT } from "./controls";
import { useSettings } from "../../prefs/SettingsContext";
import {
  type ConnectedState,
  localizedLabel,
} from "../../ai/provider-connection";
import { explainError } from "../../utils/error-explain";

/** Signing in to one AI provider: the account and API-key panels, and the
 *  custom endpoint's address, key and model. */

/// Tabs between oauth and api_key auth when both are available, else just
/// the one panel.
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
  // Defaults to whichever method is connected, else oauth, which the backend
  // prefers when both are configured.
  const [tab, setTab] = useState<"oauth" | "api_key">(() => {
    if (!hasOauth) return "api_key";
    if (!hasApiKey) return "oauth";
    return connected?.apiKey && !connected?.oauth ? "api_key" : "oauth";
  });

  const label = localizedLabel(entry, t);

  return (
    <div>
      {hasOauth && hasApiKey && (
        <Segmented
          className="settings-segmented"
          label={label}
          options={[
            { id: "oauth", label: t.authTabAccount },
            { id: "api_key", label: t.authTabApiKey },
          ]}
          value={tab}
          onChange={setTab}
        />
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
      {entry.keyOptional && entry.baseUrl && (
        <AddressRow
          t={t}
          providerId={entry.id}
          label={label}
          usual={entry.baseUrl}
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

function OauthPanel({
  t,
  providerId,
  label,
  unofficial = false,
  onStatusChange,
}: {
  t: Strings;
  providerId: string;
  label: string;
  unofficial?: boolean;
  onStatusChange?: (configured: boolean) => void;
}) {
  const [configured, setConfiguredState] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  // Shown while signing in: some machines open no browser, and then this is
  // the only way in.
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The parent hears each status; its handler is read through a ref.
  const onStatus = useLatest(onStatusChange);
  const setConfigured = useCallback(
    (ok: boolean) => {
      setConfiguredState(ok);
      onStatus.current?.(ok);
    },
    [onStatus],
  );

  useEffect(() => {
    auth
      .oauthStatus(providerId)
      .then((s) => setConfigured(s.configured))
      .catch(() => {});
  }, [providerId, setConfigured]);

  async function login() {
    setLoggingIn(true);
    setError(null);
    setLoginUrl(null);
    setCopied(false);
    try {
      const status = await auth.oauthLogin(providerId, setLoginUrl);
      setConfigured(status.configured);
    } catch (err) {
      setError(explainError(err, t));
    } finally {
      setLoggingIn(false);
      setLoginUrl(null);
    }
  }

  async function logout() {
    try {
      await auth.oauthLogout(providerId);
      setConfigured(false);
    } catch (err) {
      setError(explainError(err, t));
    }
  }

  return (
    <div>
      {error && <div className="settings-error">{error}</div>}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">
            {fill(t.accountLabelTemplate, { name: label })}
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
              {t.signInExperimental}
            </div>
          )}
        </div>
        {configured ? (
          <button
            className="tx-button text-button settings-inline-button"
            onClick={logout}
          >
            {t.logoutButton}
          </button>
        ) : (
          <button
            className="tx-button text-button settings-inline-button"
            onClick={login}
            disabled={loggingIn}
          >
            {fill(t.signInTemplate, { name: label })}
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
            className="tx-button text-button settings-inline-button"
            onClick={() => {
              void navigator.clipboard
                .writeText(loginUrl)
                .then(() => setCopied(true));
            }}
          >
            {copied ? t.codeBlockCopied : t.loginLinkCopy}
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
  // Why the key couldn't be kept or let go (the keychain refused).
  const [error, setError] = useState<string | null>(null);

  // The parent hears each status; its handler is read through a ref.
  const onStatus = useLatest(onStatusChange);
  const setConfigured = useCallback(
    (ok: boolean) => {
      setConfiguredState(ok);
      onStatus.current?.(ok);
    },
    [onStatus],
  );

  useEffect(() => {
    auth
      .providerApiKeyStatus(providerId)
      .then(setConfigured, () => setConfigured(false));
  }, [providerId, setConfigured]);

  async function save() {
    if (!input.trim()) return;
    try {
      await auth.setProviderApiKey(providerId, input.trim());
      setError(null);
      setInput("");
      setConfigured(true);
    } catch (err) {
      setError(explainError(err, t));
    }
  }

  async function clear() {
    try {
      await auth.clearProviderApiKey(providerId);
      setError(null);
      setConfigured(false);
    } catch (err) {
      setError(explainError(err, t));
    }
  }

  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">
          {fill(t.apiKeyLabelTemplate, { name: label })}
          {keyOptional && (
            <RowHelp label={fill(t.apiKeyLabelTemplate, { name: label })}>
              {fill(t.apiKeyOptionalHintTemplate, { name: label })}
            </RowHelp>
          )}
        </div>
        {error && <div className="settings-error">{error}</div>}
      </div>
      <SecretInput
        t={t}
        label={fill(t.apiKeyLabelTemplate, { name: label })}
        saved={configured}
        value={input}
        onChange={setInput}
        onSave={save}
        onClear={clear}
      />
    </div>
  );
}

/** Where a service on this computer answers, when not at its usual address
 *  (Magpie on another port, Ollama on another machine): empty is the usual
 *  one. Kept on leaving the field. */
function AddressRow({
  t,
  providerId,
  label,
  usual,
}: {
  t: Strings;
  providerId: string;
  label: string;
  usual: string;
}) {
  const { settings, setSettings } = useSettings();
  const saved = settings.providerAddresses[providerId] ?? "";
  const [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [saved]);
  const keep = () => {
    const at = value.trim();
    if (at === saved) return;
    const next = { ...settings.providerAddresses };
    if (/^https?:\/\//.test(at)) next[providerId] = at;
    else delete next[providerId];
    setSettings({ providerAddresses: next });
    if (!/^https?:\/\//.test(at)) setValue("");
  };
  const name = fill(t.providerAddressLabel, { name: label });
  return (
    <SettingRow
      label={name}
      help={fill(t.providerAddressHint, { name: label, address: usual })}
    >
      <input
        type="url"
        {...VERBATIM_INPUT}
        className="tx-input settings-text-input"
        aria-label={name}
        placeholder={usual}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={keep}
        onKeyDown={(e) => {
          if (e.key === "Enter") keep();
        }}
      />
    </SettingRow>
  );
}
