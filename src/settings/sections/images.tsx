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
import {
  DEFAULT_IMAGE_SUBFOLDER,
  SAME_FOLDER,
  imageFolderExample,
  isImageSubfolder,
} from "../image-folder";
import { Select } from "../../ui/Select";
import { RowHelp, SettingRow, VERBATIM_INPUT } from "./controls";

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

/** Where a saved document's images go: its own folder, or a subfolder
 *  named beside the choice. Under it, the link a paste writes - what
 *  "assets" means is clearer as the Markdown it produces than as a
 *  description. The name is kept as typed but only stored once the
 *  backend would take it, so a half-typed or refused name never reaches
 *  a paste. */
function ImageFolderRow({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const same = settings.imageFolder === SAME_FOLDER;
  const [name, setName] = useState(() =>
    same ? DEFAULT_IMAGE_SUBFOLDER : settings.imageFolder,
  );
  const valid = isImageSubfolder(name);
  const example = imageFolderExample(same ? SAME_FOLDER : name, "photo.png");
  return (
    <SettingRow
      label={t.imageFolderLabel}
      hint={
        example === null ? undefined : (
          <code className="image-folder-example">{`![](${example})`}</code>
        )
      }
      error={!same && !valid ? t.imageFolderInvalid : null}
    >
      <div className="image-folder-control">
        <Select
          className="settings-select"
          aria-label={t.imageFolderLabel}
          value={same ? "same" : "subfolder"}
          onChange={(e) =>
            setSettings({
              imageFolder:
                e.target.value === "same"
                  ? SAME_FOLDER
                  : valid
                    ? name.trim()
                    : DEFAULT_IMAGE_SUBFOLDER,
            })
          }
        >
          <option value="subfolder">{t.imageFolderSubfolder}</option>
          <option value="same">{t.imageFolderSameFolder}</option>
        </Select>
        {!same && (
          <input
            {...VERBATIM_INPUT}
            className="settings-text-input image-folder-input"
            aria-label={t.imageFolderNameLabel}
            aria-invalid={!valid}
            placeholder={DEFAULT_IMAGE_SUBFOLDER}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (isImageSubfolder(e.target.value))
                setSettings({ imageFolder: e.target.value.trim() });
            }}
          />
        )}
      </div>
    </SettingRow>
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
          help={t.imagePicgoEndpointHint}
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
            help={t.imageUploadEndpointHint}
            type="url"
            placeholder="https://images.example.com/upload"
            value={settings.imageUploadEndpoint}
            onChange={(v) => setSettings({ imageUploadEndpoint: v })}
          />
          <TextFieldRow
            label={t.imageUploadUrlFieldLabel}
            help={t.imageUploadUrlFieldHint}
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
  help,
  type = "text",
  placeholder,
  value,
  onChange,
}: {
  label: string;
  help: string;
  type?: "text" | "url";
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  // The field is named by the label alone: the "?" inside the <label>
  // would otherwise be read as part of its name, or taken as what the
  // <label> labels.
  const id = useId();
  return (
    <label className="settings-row image-settings-row" htmlFor={id}>
      <div className="settings-row-label">
        <span id={`${id}-label`}>{label}</span>
        <RowHelp label={label}>{help}</RowHelp>
      </div>
      <input
        id={id}
        aria-labelledby={`${id}-label`}
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
  const { label, help, optional } = {
    picgo: {
      label: t.imagePicgoKeyLabel,
      help: t.imagePicgoKeyHint,
      optional: true,
    },
    smms: {
      label: t.imageSmmsTokenLabel,
      help: t.imageSmmsTokenHint,
      optional: false,
    },
    imgur: {
      label: t.imageImgurClientIdLabel,
      help: t.imageImgurClientIdHint,
      optional: false,
    },
    custom: {
      label: t.imageUploadTokenLabel,
      help: t.imageUploadTokenHint,
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
    <SettingRow label={label} help={help} error={error}>
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
