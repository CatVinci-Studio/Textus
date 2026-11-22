import { useState } from "react";
import type { Strings } from "../../i18n/strings";
import { auth, type CustomEndpointConfig } from "../../platform/ipc";
import { Select } from "../../engine/controls/Select";
import { showConfirm } from "../../engine/controls/app-dialog";
import { MaskedKeyInput, VERBATIM_INPUT } from "./controls";
import { explainError } from "../../utils/error-explain";
import { fill } from "../../i18n/fill";
import { writeFetchedModels } from "../../ai/model-info";
import { useSettings } from "../../prefs/SettingsContext";
import {
  endpointLabel,
  refreshCustomEndpoints,
} from "../../ai/custom-endpoints";
import {
  sameEndpoint,
  settingsWithout,
  useEndpointForm,
} from "./custom-provider-form";

/** One custom endpoint's name, address, key and model: an OpenAI-compatible
 *  server of the user's own. Its model list is kept with the providers'
 *  fetched lists, under its id, so the model pickers and the chat offer the
 *  same names. With no `endpoint`, the panel adds a new one. */
export function CustomProviderPanel({
  t,
  endpoint,
  onSaved,
  onRemoved,
}: {
  t: Strings;
  endpoint?: CustomEndpointConfig;
  onSaved: (id: string) => void;
  onRemoved: () => void;
}) {
  const { form, set, models, setListed } = useEndpointForm(endpoint);
  const { settings, setSettings } = useSettings();
  /** What the last action said: an error, or that it worked. */
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(
    null,
  );
  const fail = (text: string) => setNote({ error: true, text });
  const baseUrl = form.baseUrl.trim();
  const model = form.model.trim();

  /** The endpoint's models, kept for every picker; null when it failed. */
  async function listModels(): Promise<string[] | null> {
    setNote(null);
    try {
      const list = await auth.fetchCustomModels(
        endpoint?.id ?? null,
        baseUrl,
        form.apiKey.trim() || null,
      );
      setListed(list);
      if (endpoint) writeFetchedModels(endpoint.id, list);
      return list;
    } catch (err) {
      fail(explainError(err, t));
      return null;
    }
  }

  async function fetchModels() {
    const list = await listModels();
    if (list?.length && !model) set({ model: list[0]! });
  }

  // Reached is not enough: the model has to be one the endpoint serves.
  async function testConnection() {
    const list = await listModels();
    if (!list) return;
    if (model && list.length > 0 && !list.includes(model)) {
      fail(fill(t.customModelNotListed, { model }));
    } else setNote({ error: false, text: t.customTestSuccess });
  }

  // An empty key field means "the saved key", but only while the URL is the
  // one it was saved with; another host is not sent the old key.
  const keySaved =
    !!endpoint?.has_api_key && sameEndpoint(endpoint.base_url, baseUrl);

  async function save() {
    if (!baseUrl || !model) return;
    let id: string;
    try {
      id = await auth.setCustomEndpoint({
        id: endpoint?.id ?? null,
        name: form.name,
        baseUrl,
        apiKey: form.apiKey.trim() || null,
        model,
      });
    } catch (err) {
      fail(explainError(err, t));
      return;
    }
    if (!endpoint) writeFetchedModels(id, models);
    // The model saved here is the one the chat and writing then use.
    setSettings({
      agentModels: { ...settings.agentModels, [id]: model },
      writingModels: { ...settings.writingModels, [id]: model },
    });
    // Like the provider keys: once saved, the key leaves the field.
    set({ apiKey: "" });
    await refreshCustomEndpoints();
    onSaved(id);
  }

  async function remove() {
    if (!endpoint) return;
    const ok = await showConfirm(
      fill(t.customEndpointRemoveAsk, { name: endpointLabel(endpoint) }),
      { okLabel: t.apiKeyClear, cancelLabel: t.cancel, danger: true },
    );
    if (!ok) return;
    try {
      await auth.clearCustomEndpoint(endpoint.id);
    } catch (err) {
      fail(explainError(err, t));
      return;
    }
    writeFetchedModels(endpoint.id, []);
    setSettings(settingsWithout(settings, endpoint.id));
    await refreshCustomEndpoints();
    onRemoved();
  }

  // A saved name the list lacks stays choosable, flagged above.
  const offered =
    form.model && !models.includes(form.model)
      ? [form.model, ...models]
      : models;

  return (
    <div className="custom-endpoint">
      {note && (
        <div className={note.error ? "settings-error" : "settings-success"}>
          {note.text}
        </div>
      )}
      <div className="custom-endpoint-fields">
        <label className="settings-field-label">{t.customNameLabel}</label>
        <input
          aria-label={t.customNameLabel}
          type="text"
          className="tx-input settings-text-input"
          placeholder={t.customNamePlaceholder}
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
        />
        <label className="settings-field-label">{t.customBaseUrlLabel}</label>
        <input
          aria-label={t.customBaseUrlLabel}
          type="text"
          inputMode="url"
          {...VERBATIM_INPUT}
          className="tx-input settings-text-input"
          placeholder={t.customBaseUrlPlaceholder}
          value={form.baseUrl}
          onChange={(e) => set({ baseUrl: e.target.value })}
        />
        <label className="settings-field-label">{t.customApiKeyLabel}</label>
        <MaskedKeyInput
          className="tx-input settings-text-input"
          label={t.customApiKeyLabel}
          placeholder={keySaved ? t.customApiKeySaved : t.apiKeyPlaceholder}
          value={form.apiKey}
          onChange={(apiKey) => set({ apiKey })}
        />
        <label className="settings-field-label">{t.customModelLabel}</label>
        <div className="custom-model-row">
          {models.length > 0 ? (
            <Select
              aria-label={t.customModelLabel}
              className="settings-select"
              value={form.model}
              onChange={(e) => set({ model: e.target.value })}
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
              value={form.model}
              onChange={(e) => set({ model: e.target.value })}
            />
          )}
          <button
            className="tx-button text-button settings-inline-button"
            onClick={fetchModels}
            disabled={!baseUrl}
          >
            {t.customFetchModels}
          </button>
        </div>
      </div>
      <div className="custom-actions-row">
        <button
          className="tx-button text-button settings-inline-button"
          onClick={testConnection}
          disabled={!baseUrl}
        >
          {t.customTestConnection}
        </button>
        <button
          className="tx-button text-button settings-inline-button"
          onClick={save}
          disabled={!baseUrl || !model}
        >
          {t.customSave}
        </button>
        {endpoint && (
          <button
            className="tx-button text-button settings-inline-button"
            onClick={remove}
          >
            {t.apiKeyClear}
          </button>
        )}
      </div>
    </div>
  );
}
