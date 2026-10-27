import { useEffect, useState } from "react";
import { useSettings } from "../../prefs/SettingsContext";
import type { Strings, TextKey } from "../../i18n/strings";
import { auth } from "../../platform/ipc";
import { Select } from "../../ui/Select";
import { SettingRow, VERBATIM_INPUT } from "./controls";
import { ApiKeyProviderPanel } from "./providers";
import {
  FOLLOW_CHAT,
  useChatGptSignedIn,
  useImageProviders,
  useImageService,
  type ImageProviderEntry,
} from "../../ai/image-models";

// Settings › Textus AI › Image model: which service makes the pictures, and
// with which model. Defaults to the chat provider's own; a key is asked for
// only when the service has none from chat.

// Brand names, but for the ones named in words.
const LOCALIZED_LABELS: Partial<Record<string, TextKey>> = {
  custom: "imageProviderCustom",
  doubao: "providerDoubao",
  minimax: "providerMiniMax",
  "minimax-intl": "providerMiniMaxIntl",
  "openai-chatgpt": "imageProviderChatGpt",
};

function label(entry: ImageProviderEntry, t: Strings): string {
  const key = LOCALIZED_LABELS[entry.id];
  return key ? t[key] : entry.label;
}

/** The choices for pictures per request; the backend holds it to 1-8. */
const PER_REQUEST = [1, 2, 3, 4, 6, 8];

export function ImageModelSection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const providers = useImageProviders();
  const signedIn = useChatGptSignedIn();
  const chosen = settings.imageModelProvider;
  const following = chosen === FOLLOW_CHAT;
  const id = useImageService(settings);
  const entry = providers.find((p) => p.id === id) ?? null;
  const followed = following && entry ? label(entry, t) : null;

  // Whether this service had no key when it was chosen: the key row stays
  // until the choice changes, so a key just saved shows as saved.
  const [askKey, setAskKey] = useState(false);
  useEffect(() => {
    let live = true;
    setAskKey(false);
    if (!entry || !entry.keyId) return;
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

  const model =
    entry && entry.models.includes(settings.imageModel)
      ? settings.imageModel
      : (entry?.models[0] ?? "");
  const chatGptWithoutSignIn = entry?.id === "openai-chatgpt" && !signedIn;

  return (
    <>
      <SettingRow
        label={t.imageServiceLabel}
        help={entry?.id === "openai-chatgpt" ? t.imageChatGptHelp : undefined}
        hint={
          following && !entry
            ? t.imageServiceFollowNoPictures
            : chatGptWithoutSignIn
              ? t.imageChatGptSignInHint
              : undefined
        }
      >
        <Select
          className="settings-select settings-model-select"
          aria-label={t.imageServiceLabel}
          value={chosen}
          onChange={(e) =>
            setSettings({ imageModelProvider: e.target.value, imageModel: "" })
          }
        >
          <option value={FOLLOW_CHAT}>
            {followed
              ? t.imageServiceFollowChat.replace("{name}", followed)
              : t.imageServiceFollowChatBare}
          </option>
          <option value="">{t.imageModelNone}</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {label(p, t)}
            </option>
          ))}
        </Select>
      </SettingRow>
      {entry && entry.models.length > 1 && (
        <SettingRow label={t.imageModelLabel}>
          <Select
            className="settings-select settings-model-select"
            aria-label={t.imageModelLabel}
            value={model}
            onChange={(e) => setSettings({ imageModel: e.target.value })}
          >
            {entry.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </SettingRow>
      )}
      {entry && (
        <SettingRow
          label={t.imagesPerRequestLabel}
          help={t.imagesPerRequestHelp}
        >
          <Select
            className="settings-select"
            aria-label={t.imagesPerRequestLabel}
            value={String(settings.imagesPerRequest)}
            onChange={(e) =>
              setSettings({ imagesPerRequest: Number(e.target.value) })
            }
          >
            {PER_REQUEST.map((n) => (
              <option key={n} value={String(n)}>
                {String(n)}
              </option>
            ))}
          </Select>
        </SettingRow>
      )}
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
