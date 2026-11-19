import { useEffect, useState } from "react";
import { useLatest } from "../../utils/hooks/useLatest";
import type { Strings } from "../../i18n/strings";
import { auth, type CustomEndpointConfig } from "../../platform/ipc";
import { Select } from "../../engine/controls/Select";
import { MaskedKeyInput, VERBATIM_INPUT } from "./controls";
import { explainError } from "../../utils/error-explain";
import { fill } from "../../i18n/fill";
import { useFetchedModels, writeFetchedModels } from "../../ai/model-info";
import { useSettings } from "../../prefs/SettingsContext";

/** The custom endpoint's address, key and model: an OpenAI-compatible
 *  server of the user's own. Its model list is kept with the providers'
 *  fetched lists, so the model pickers and the chat offer the same names. */

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
  const { models } = useFetchedModels("custom");
  const { settings, setSettings } = useSettings();
  const [selectedModel, setSelectedModel] = useState("");
  /** What the last action said: an error, or that it worked. */
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(
    null,
  );
  const fail = (text: string) => setNote({ error: true, text });
  useSavedEndpoint((c) => {
    setConfig(c);
    setBaseUrl(c.base_url);
    // The key never comes back (only `has_api_key`): the empty field
    // says it's saved, in its placeholder.
    setApiKey("");
    setSelectedModel(c.model);
    onStatusChange?.(true);
  });

  /** The endpoint's models, kept for every picker; null when it failed. */
  async function listModels(): Promise<string[] | null> {
    setNote(null);
    try {
      const list = await auth.fetchCustomModels(baseUrl, apiKey.trim() || null);
      writeFetchedModels("custom", list);
      return list;
    } catch (err) {
      fail(explainError(err, t));
      return null;
    }
  }

  async function fetchModels() {
    const list = await listModels();
    if (list?.length && !selectedModel) setSelectedModel(list[0]!);
  }

  // Reached is not enough: the model has to be one the endpoint serves.
  async function testConnection() {
    const list = await listModels();
    if (!list) return;
    const model = selectedModel.trim();
    if (model && list.length > 0 && !list.includes(model)) {
      fail(fill(t.customModelNotListed, { model }));
    } else setNote({ error: false, text: t.customTestSuccess });
  }

  // An empty key field means "the saved key", but only while the URL is the
  // one it was saved with; another host is not sent the old key.
  const keySaved =
    !!config?.has_api_key && sameEndpoint(config.base_url, baseUrl);

  async function save() {
    if (!baseUrl.trim() || !selectedModel.trim()) return;
    const typed = apiKey.trim();
    const model = selectedModel.trim();
    try {
      await auth.setCustomEndpoint(baseUrl.trim(), typed || null, model);
    } catch (err) {
      fail(explainError(err, t));
      return;
    }
    // The model saved here is the one the chat and writing then use.
    setSettings({
      agentModels: { ...settings.agentModels, custom: model },
      writingModels: { ...settings.writingModels, custom: model },
    });
    setConfig({
      base_url: baseUrl.trim(),
      api_key: null,
      has_api_key: !!typed || keySaved,
      model,
    });
    // Like the provider keys: once saved, the key leaves the field.
    setApiKey("");
    onStatusChange?.(true);
  }

  async function clear() {
    try {
      await auth.clearCustomEndpoint();
    } catch (err) {
      fail(explainError(err, t));
      return;
    }
    setConfig(null);
    setBaseUrl("");
    setApiKey("");
    setSelectedModel("");
    writeFetchedModels("custom", []);
    setNote(null);
    onStatusChange?.(false);
  }

  // A saved name the list lacks stays choosable, flagged above.
  const offered =
    selectedModel && !models.includes(selectedModel)
      ? [selectedModel, ...models]
      : models;

  return (
    <div className="custom-endpoint">
      {note && (
        <div className={note.error ? "settings-error" : "settings-success"}>
          {note.text}
        </div>
      )}
      <div className="custom-endpoint-fields">
        <label className="settings-field-label">{t.customBaseUrlLabel}</label>
        <input
          aria-label={t.customBaseUrlLabel}
          type="text"
          inputMode="url"
          {...VERBATIM_INPUT}
          className="tx-input settings-text-input"
          placeholder={t.customBaseUrlPlaceholder}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
        <label className="settings-field-label">{t.customApiKeyLabel}</label>
        <MaskedKeyInput
          className="tx-input settings-text-input"
          label={t.customApiKeyLabel}
          placeholder={keySaved ? t.customApiKeySaved : t.apiKeyPlaceholder}
          value={apiKey}
          onChange={setApiKey}
        />
        <label className="settings-field-label">{t.customModelLabel}</label>
        <div className="custom-model-row">
          {models.length > 0 ? (
            <Select
              aria-label={t.customModelLabel}
              className="settings-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              {offered.map((m) => (
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
              className="tx-input settings-text-input"
              placeholder={t.customModelPlaceholder}
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            />
          )}
          <button
            className="tx-button text-button settings-inline-button"
            onClick={fetchModels}
            disabled={!baseUrl.trim()}
          >
            {t.customFetchModels}
          </button>
        </div>
      </div>
      <div className="custom-actions-row">
        <button
          className="tx-button text-button settings-inline-button"
          onClick={testConnection}
          disabled={!baseUrl.trim()}
        >
          {t.customTestConnection}
        </button>
        <button
          className="tx-button text-button settings-inline-button"
          onClick={save}
          disabled={!baseUrl.trim() || !selectedModel.trim()}
        >
          {t.customSave}
        </button>
        {config && (
          <button
            className="tx-button text-button settings-inline-button"
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
