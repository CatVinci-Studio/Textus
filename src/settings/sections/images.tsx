import { errorText } from "../../utils/error-text";
import { useEffect, useId, useState } from "react";
import { imageHostAuth } from "../../platform/ipc";
import type { Strings } from "../../i18n/strings";
import {
  useSettings,
  type ImageHost,
  type ImageNamingMode,
  type ImageStorageMode,
} from "../SettingsContext";
import { IMAGE_FOLDER_PRESETS, imageFolderExample } from "../image-folder";
import { Select } from "../../ui/Select";
import { SettingRow, VERBATIM_INPUT } from "./controls";

/** Settings > Images: one choice - this computer or an image host - and
 *  then only what that choice needs. */
export function ImageStorageSection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const remote = settings.imageStorageMode === "image-host";
  return (
    <>
      <SettingRow label={t.imageStorageLabel}>
        <Select
          className="settings-select"
          aria-label={t.imageStorageLabel}
          value={settings.imageStorageMode}
          onChange={(e) =>
            setSettings({
              imageStorageMode: e.target.value as ImageStorageMode,
            })
          }
        >
          <option value="local">{t.imageStorageLocal}</option>
          <option value="image-host">{t.imageStorageRemote}</option>
        </Select>
      </SettingRow>
      {remote ? <ImageHostRows t={t} /> : <ImageFolderRow t={t} />}
    </>
  );
}

/** The link a choice writes, shown beside it: what "assets" or "./" means
 *  is clearer as the Markdown it produces than as a description. */
function Example({ folder }: { folder: string }) {
  const src = imageFolderExample(folder, "notes", "photo.png");
  return src === null ? null : (
    <code className="image-folder-example">{`![](${src})`}</code>
  );
}

function ImageFolderRow({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const folder = settings.imageFolder;
  const [custom, setCustom] = useState(
    () => !IMAGE_FOLDER_PRESETS.includes(folder),
  );
  const name = useId();
  const presetLabels: Record<string, string> = {
    assets: "assets/",
    "./": t.imageFolderNextToDocument,
    "${filename}.assets": t.imageFolderDocumentName,
  };
  return (
    <div className="settings-row settings-row-stacked">
      <div className="settings-row-label" id={`${name}-label`}>
        {t.imageFolderLabel}
      </div>
      <div
        className="image-folder-options"
        role="radiogroup"
        aria-labelledby={`${name}-label`}
      >
        {IMAGE_FOLDER_PRESETS.map((preset) => (
          <label key={preset} className="image-folder-option">
            <input
              type="radio"
              name={name}
              checked={!custom && folder === preset}
              onChange={() => {
                setCustom(false);
                setSettings({ imageFolder: preset });
              }}
            />
            <span>{presetLabels[preset]}</span>
            <Example folder={preset} />
          </label>
        ))}
        <label className="image-folder-option">
          <input
            type="radio"
            name={name}
            checked={custom}
            onChange={() => setCustom(true)}
          />
          <span>{t.imageFolderCustom}</span>
          {custom && <Example folder={folder} />}
        </label>
        {custom && (
          <>
            <input
              {...VERBATIM_INPUT}
              className="settings-text-input image-folder-input"
              aria-label={t.imageFolderCustom}
              placeholder="img"
              value={folder}
              onChange={(e) => setSettings({ imageFolder: e.target.value })}
            />
            {imageFolderExample(folder, "notes", "photo.png") === null && (
              <div className="settings-error">{t.imageFolderInvalid}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const HOST_NAMES: Record<Exclude<ImageHost, "custom">, string> = {
  picgo: "PicGo / PicList",
  smms: "SM.MS",
  imgur: "Imgur",
};

function ImageHostRows({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const host = settings.imageHost;
  return (
    <>
      <SettingRow label={t.imageHostLabel}>
        <Select
          className="settings-select"
          aria-label={t.imageHostLabel}
          value={host}
          onChange={(e) =>
            setSettings({ imageHost: e.target.value as ImageHost })
          }
        >
          {Object.entries(HOST_NAMES).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
          <option value="custom">{t.imageHostCustom}</option>
        </Select>
      </SettingRow>
      {host === "picgo" && (
        <TextFieldRow
          label={t.imagePicgoEndpointLabel}
          hint={t.imagePicgoEndpointHint}
          type="url"
          placeholder="http://127.0.0.1:36677/upload"
          value={settings.imagePicgoEndpoint}
          onChange={(v) => setSettings({ imagePicgoEndpoint: v })}
        />
      )}
      {host === "custom" && (
        <>
          <TextFieldRow
            label={t.imageUploadEndpointLabel}
            hint={t.imageUploadEndpointHint}
            type="url"
            placeholder="https://images.example.com/upload"
            value={settings.imageUploadEndpoint}
            onChange={(v) => setSettings({ imageUploadEndpoint: v })}
          />
          <TextFieldRow
            label={t.imageUploadUrlFieldLabel}
            hint={t.imageUploadUrlFieldHint}
            placeholder="url"
            value={settings.imageUploadUrlField}
            onChange={(v) => setSettings({ imageUploadUrlField: v })}
          />
        </>
      )}
      {/* Keyed: each host keeps its own token. */}
      <ImageHostTokenRow key={host} host={host} t={t} />
      <SettingRow label={t.imageNamingLabel}>
        <Select
          className="settings-select"
          aria-label={t.imageNamingLabel}
          value={settings.imageNamingMode}
          onChange={(e) =>
            setSettings({
              imageNamingMode: e.target.value as ImageNamingMode,
            })
          }
        >
          <option value="auto">{t.imageNamingAuto}</option>
          <option value="original">{t.imageNamingOriginal}</option>
          <option value="ask">{t.imageNamingAsk}</option>
        </Select>
      </SettingRow>
    </>
  );
}

function TextFieldRow({
  label,
  hint,
  type = "text",
  placeholder,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  type?: "text" | "url";
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="settings-row image-settings-row">
      <div>
        <div className="settings-row-label">{label}</div>
        <div className="settings-row-hint">{hint}</div>
      </div>
      <input
        {...VERBATIM_INPUT}
        className="settings-text-input image-settings-input"
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function ImageHostTokenRow({ host, t }: { host: ImageHost; t: Strings }) {
  const [token, setToken] = useState("");
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What each host calls its token, and whether it can do without one.
  const { label, hint, optional } = {
    picgo: {
      label: t.imagePicgoKeyLabel,
      hint: t.imagePicgoKeyHint,
      optional: true,
    },
    smms: {
      label: t.imageSmmsTokenLabel,
      hint: t.imageSmmsTokenHint,
      optional: false,
    },
    imgur: {
      label: t.imageImgurClientIdLabel,
      hint: t.imageImgurClientIdHint,
      optional: false,
    },
    custom: {
      label: t.imageUploadTokenLabel,
      hint: t.imageUploadTokenHint,
      optional: true,
    },
  }[host];

  useEffect(() => {
    imageHostAuth
      .tokenStatus(host)
      .then(setTokenConfigured)
      .catch(() => {});
  }, [host]);

  async function saveToken() {
    if (!token.trim()) return;
    try {
      await imageHostAuth.setToken(host, token.trim());
      setToken("");
      setTokenConfigured(true);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function clearToken() {
    try {
      await imageHostAuth.clearToken(host);
      setTokenConfigured(false);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <SettingRow label={label} hint={hint} error={error}>
      {tokenConfigured ? (
        <div className="api-key-configured">
          <span className="settings-row-hint">{t.apiKeyConfigured}</span>
          <button
            className="text-button settings-inline-button"
            onClick={clearToken}
          >
            {t.apiKeyClear}
          </button>
        </div>
      ) : (
        <div className="api-key-input-row">
          <input
            type="password"
            className="settings-text-input api-key-input"
            aria-label={label}
            placeholder={optional ? t.imageUploadTokenPlaceholder : ""}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button
            className="text-button settings-inline-button"
            onClick={saveToken}
            disabled={!token.trim()}
          >
            {t.apiKeySave}
          </button>
        </div>
      )}
    </SettingRow>
  );
}
