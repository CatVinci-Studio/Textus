import { useEffect, useState } from "react";
import { useLatest } from "../../utils/hooks/useLatest";
import type { Strings } from "../../i18n/strings";
import { auth, type CustomEndpointConfig } from "../../platform/ipc";
import { Select } from "../../engine/controls/Select";
import { MaskedKeyInput, VERBATIM_INPUT } from "./controls";
import { explainError } from "../../utils/error-explain";

/** The custom endpoint's address, key and model: an OpenAI-compatible
 *  server of the user's own. */

/** Whether two base URLs name the same endpoint, by the backend's rule for
 *  sending a stored key to a URL. */
function sameEndpoint(a: string, b: string): boolean {
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
  useSavedEndpoint((c) => {
    setConfig(c);
    setBaseUrl(c.base_url);
    // The key never comes back (only `has_api_key`): the empty field
    // says it's saved, in its placeholder.
    setApiKey("");
    setSelectedModel(c.model);
    onStatusChange?.(true);
  });

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
      setStatusMessage(explainError(err, t));
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
      setStatusMessage(explainError(err, t));
    }
  }

  // An empty key field means "the saved key", but only while the URL is the
  // one it was saved with; another host is not sent the old key.
  const keySaved =
    !!config?.has_api_key && sameEndpoint(config.base_url, baseUrl);

  async function save() {
    if (!baseUrl.trim() || !selectedModel.trim()) return;
    const typed = apiKey.trim();
    try {
      await auth.setCustomEndpoint(
        baseUrl.trim(),
        typed || null,
        selectedModel.trim(),
      );
    } catch (err) {
      setStatus("error");
      setStatusMessage(explainError(err, t));
      return;
    }
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
    try {
      await auth.clearCustomEndpoint();
    } catch (err) {
      setStatus("error");
      setStatusMessage(explainError(err, t));
      return;
    }
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
          aria-label={t.customBaseUrlLabel}
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
              aria-label={t.customModelLabel}
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
              aria-label={t.customModelLabel}
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

/** What is saved for the custom endpoint, handed to `onLoaded` once, as
 *  its section opens. */
function useSavedEndpoint(onLoaded: (config: CustomEndpointConfig) => void) {
  const loaded = useLatest(onLoaded);
  useEffect(() => {
    void auth.customEndpointStatus().then((c) => {
      if (c) loaded.current(c);
    });
  }, [loaded]);
}
