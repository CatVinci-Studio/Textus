import { useEffect, useState } from "react";
import { useSettings } from "../SettingsContext";
import type { Strings } from "../../i18n/strings";
import { auth } from "../../platform/ipc";
import { Select } from "../../ui/Select";
import { SettingRow, VERBATIM_INPUT } from "./controls";
import { ApiKeyProviderPanel } from "./providers";
import {
  useImageProviders,
  type ImageProviderEntry,
} from "../../ai/image-models";

// Settings › Textus AI › Image model (#194): which service makes the
// pictures generate_image proposes. None by default - a picture costs
// money, and the agent offers to make one only once this is set. A key is
// asked for only when the service doesn't already have one from chat.

function label(entry: ImageProviderEntry, t: Strings): string {
  if (entry.id === "custom") return t.imageProviderCustom;
  if (entry.id === "doubao") return t.providerDoubao;
  return entry.label;
}

/** `provider|model`, the select's value for one choice. */
const choice = (provider: string, model: string) => `${provider}|${model}`;

export function ImageModelSection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const providers = useImageProviders();
  const provider = settings.imageModelProvider;
  const entry = providers.find((p) => p.id === provider) ?? null;
  // Whether this service had no key when it was chosen: the key row stays
  // until the choice changes, so a key just saved shows as saved.
  const [askKey, setAskKey] = useState(false);
  useEffect(() => {
    let live = true;
    setAskKey(false);
    if (!entry) return;
    if (entry.id === "custom") {
      setAskKey(true);
      return;
    }
    void auth
      .providerApiKeyStatus(entry.keyId)
      .then((has) => live && setAskKey(!has))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [entry]);

  const model = entry?.models.length
    ? settings.imageModel || entry.models[0]
    : settings.imageModel;
  const value = entry ? choice(entry.id, entry.models.length ? model : "") : "";

  function pick(next: string) {
    const [id, picked = ""] = next.split("|");
    setSettings({ imageModelProvider: id, imageModel: picked });
  }

  return (
    <>
      <SettingRow label={t.imageModelLabel}>
        <Select
          className="settings-select settings-model-select"
          aria-label={t.imageModelLabel}
          value={value}
          onChange={(e) => pick(e.target.value)}
        >
          <option value="">{t.imageModelNone}</option>
          {providers.flatMap((p) =>
            p.models.length
              ? p.models.map((m) => (
                  <option key={choice(p.id, m)} value={choice(p.id, m)}>
                    {`${label(p, t)} · ${m}`}
                  </option>
                ))
              : [
                  <option key={choice(p.id, "")} value={choice(p.id, "")}>
                    {label(p, t)}
                  </option>,
                ],
          )}
        </Select>
      </SettingRow>
      {entry?.id === "custom" && (
        <>
          <SettingRow label={t.imageModelEndpointLabel}>
            <input
              type="url"
              {...VERBATIM_INPUT}
              className="settings-text-input"
              aria-label={t.imageModelEndpointLabel}
              placeholder="https://api.example.com/v1"
              value={settings.imageModelEndpoint}
              onChange={(e) =>
                setSettings({ imageModelEndpoint: e.target.value })
              }
            />
          </SettingRow>
          <SettingRow label={t.imageModelNameLabel}>
            <input
              type="text"
              {...VERBATIM_INPUT}
              className="settings-text-input"
              aria-label={t.imageModelNameLabel}
              placeholder={t.customModelPlaceholder}
              value={settings.imageModel}
              onChange={(e) => setSettings({ imageModel: e.target.value })}
            />
          </SettingRow>
        </>
      )}
      {entry && askKey && (
        <ApiKeyProviderPanel
          t={t}
          providerId={entry.keyId}
          label={label(entry, t)}
          keyOptional={entry.id === "custom"}
        />
      )}
    </>
  );
}
