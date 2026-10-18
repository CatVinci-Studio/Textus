import { useEffect, useId, useState } from "react";
import {
  media,
  type MediaCapability,
  type MediaProviderConfig,
  type MediaProviders,
} from "../../platform/ipc";
import {
  mediaPresets,
  mediaProviderDefaults,
} from "../../media/provider-catalog";
import { errorText } from "../../utils/error-text";
import { Select } from "../../ui/Select";
import { SettingRow, ToggleRow, VERBATIM_INPUT } from "./controls";

function MediaProviderForm({
  capability,
  initial,
  language,
  onSaved,
}: {
  capability: MediaCapability;
  initial?: MediaProviderConfig;
  language: string;
  onSaved: (config: MediaProviderConfig | undefined) => void;
}) {
  const zh = language.startsWith("zh");
  const presets = mediaPresets(capability);
  const supported = !initial || presets.some((p) => p.id === initial.provider);
  const [config, setConfig] = useState<MediaProviderConfig>(() =>
    initial && supported
      ? initial
      : mediaProviderDefaults(
          capability === "stt" ? "system" : "openai",
          capability,
        ),
  );
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const keyId = useId();
  const local = config.provider === "system";
  useEffect(() => {
    let active = true;
    void media
      .keyStatus(capability)
      .then((value) => {
        if (active) setHasKey(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [capability]);
  function update(patch: Partial<MediaProviderConfig>) {
    setConfig((current) => ({ ...current, ...patch }));
    setDirty(true);
    setStatus("");
    setError("");
  }
  async function save() {
    setBusy(true);
    setStatus("");
    setError("");
    try {
      if (!local && config.credentialSource !== "minimax-chat" && key.trim()) {
        await media.setKey(capability, key.trim());
        setKey("");
        setHasKey(true);
      }
      const saved = local
        ? {
            ...mediaProviderDefaults("system", "stt"),
            language: config.language?.trim() || null,
          }
        : {
            ...config,
            endpoint: config.endpoint.trim(),
            model: config.model.trim(),
            language: config.language?.trim() || null,
          };
      await media.configure(capability, saved);
      onSaved(saved);
      setDirty(false);
      setStatus(zh ? "已保存" : "Saved");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    setError("");
    try {
      if (capability === "stt") {
        const system = {
          ...mediaProviderDefaults("system", "stt"),
          language: config.language?.trim() || null,
        };
        await media.configure("stt", system);
        setConfig(system);
        setKey("");
        onSaved(system);
        setDirty(false);
        setStatus(zh ? "已使用系统听写" : "Using system dictation");
        return;
      }
      await media.configure(capability, null);
      onSaved(undefined);
      setDirty(false);
      setStatus(zh ? "已停用" : "Disabled");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const label = (en: string, cn: string) => (zh ? cn : en);
  return (
    <form
      className="media-provider-form"
      aria-label={label("Media preferences", "媒体偏好")}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {!supported && (
        <p className="settings-error" role="alert">
          {label(
            "The saved service does not support this capability. Choose another service.",
            "已保存的服务不支持此功能，请选择其他服务。",
          )}
        </p>
      )}
      <SettingRow label={label("Service", "服务")}>
        <Select
          className="settings-select"
          aria-label={label("Service", "服务")}
          value={config.provider}
          disabled={busy}
          onChange={(event) => {
            setConfig(
              mediaProviderDefaults(
                event.target.value as MediaProviderConfig["provider"],
                capability,
              ),
            );
            setKey("");
            setDirty(true);
            setStatus("");
            setError("");
          }}
        >
          {presets.map((preset) => (
            <option value={preset.id} key={preset.id}>
              {preset.id === "system" && zh ? "系统 · 本机识别" : preset.label}
            </option>
          ))}
        </Select>
      </SettingRow>
      {local ? (
        <p className="media-settings-note">
          {label(
            "Uses your system’s speech recognition. Availability depends on your device and language.",
            "使用系统语音识别，可用性取决于设备与语言。",
          )}
        </p>
      ) : (
        <>
          <SettingRow label={label("Model", "模型")}>
            <input
              {...VERBATIM_INPUT}
              className="settings-text-input"
              aria-label={label("Model", "模型")}
              required
              disabled={busy}
              value={config.model}
              onChange={(event) => update({ model: event.target.value })}
            />
          </SettingRow>
          {capability === "tts" && (
            <>
              <SettingRow label={label("Voice", "音色")}>
                <input
                  {...VERBATIM_INPUT}
                  className="settings-text-input"
                  aria-label={label("Voice", "音色")}
                  required
                  disabled={busy}
                  value={config.voice ?? ""}
                  onChange={(event) => update({ voice: event.target.value })}
                />
              </SettingRow>
              <SettingRow label={label("Speed", "语速")}>
                <Select
                  className="settings-select"
                  aria-label={label("Speed", "语速")}
                  disabled={busy}
                  value={String(config.playbackRate ?? 1)}
                  onChange={(event) =>
                    update({ playbackRate: Number(event.target.value) })
                  }
                >
                  {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
                    <option value={String(rate)} key={rate}>
                      {rate}×
                    </option>
                  ))}
                </Select>
              </SettingRow>
            </>
          )}
          {config.provider === "minimax" && (
            <ToggleRow
              label={label(
                "Reuse MiniMax text key",
                "复用 MiniMax 文字服务密钥",
              )}
              checked={config.credentialSource === "minimax-chat"}
              onChange={(checked) => {
                setKey("");
                update({
                  credentialSource: checked ? "minimax-chat" : "separate",
                });
              }}
            />
          )}
          <SettingRow label={label("API key", "API 密钥")}>
            <input
              id={keyId}
              aria-label={label("API key", "API 密钥")}
              {...VERBATIM_INPUT}
              className="settings-text-input"
              type="password"
              autoComplete="new-password"
              disabled={busy || config.credentialSource === "minimax-chat"}
              value={key}
              placeholder={
                config.credentialSource === "minimax-chat"
                  ? label("Using text service key", "使用文字服务密钥")
                  : hasKey
                    ? label("•••••••• · Stored", "•••••••• · 已保存")
                    : label("Enter key", "输入密钥")
              }
              onChange={(event) => {
                setKey(event.target.value);
                setDirty(true);
                setStatus("");
              }}
            />
          </SettingRow>
          <details
            className="settings-disclosure media-settings-advanced"
            open={
              config.provider === "openai-compatible" ||
              config.provider === "azure-speech"
                ? true
                : undefined
            }
          >
            <summary className="settings-disclosure-summary">
              {label("Connection details", "连接详情")}
            </summary>
            <SettingRow
              label={label("API base URL", "API 基础地址")}
              hint={
                config.provider === "azure-speech"
                  ? label(
                      "Use your Azure resource region or custom domain.",
                      "填写 Azure 资源所属区域或自定义域名。",
                    )
                  : undefined
              }
            >
              <input
                {...VERBATIM_INPUT}
                className="settings-text-input"
                aria-label={label("API base URL", "API 基础地址")}
                type="url"
                required
                disabled={busy}
                placeholder="https://api.example.com/v1"
                value={config.endpoint}
                onChange={(event) => update({ endpoint: event.target.value })}
              />
            </SettingRow>
          </details>
        </>
      )}
      {capability !== "image" && (
        <SettingRow label={label("Language", "语言")}>
          <input
            {...VERBATIM_INPUT}
            className="settings-text-input"
            aria-label={label("Language", "语言")}
            disabled={busy}
            placeholder={label("Automatic", "自动")}
            value={config.language ?? ""}
            onChange={(event) =>
              update({ language: event.target.value || null })
            }
          />
        </SettingRow>
      )}
      <div className="media-settings-actions">
        <button
          type="submit"
          className="text-button settings-inline-button"
          disabled={busy}
        >
          {label("Save", "保存")}
        </button>
        {initial && (capability !== "stt" || initial.provider !== "system") && (
          <button
            type="button"
            className="text-button settings-inline-button"
            disabled={busy}
            onClick={() => void disable()}
          >
            {capability === "stt"
              ? label("Use system", "使用系统听写")
              : label("Disable", "停用")}
          </button>
        )}
        {!local && hasKey && config.credentialSource !== "minimax-chat" && (
          <button
            type="button"
            className="settings-skill-action"
            disabled={busy}
            onClick={() => {
              void media.clearKey(capability).then(
                () => setHasKey(false),
                (e) => setError(errorText(e)),
              );
            }}
          >
            {label("Clear key", "清除密钥")}
          </button>
        )}
        <span className="media-settings-state" role="status">
          {status || (dirty ? label("Unsaved changes", "尚未保存") : "")}
        </span>
      </div>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function MediaSettings({ language }: { language: string }) {
  const zh = language.startsWith("zh");
  const [providers, setProviders] = useState<MediaProviders | null>(null);
  const [active, setActive] = useState<MediaCapability>("stt");
  const [error, setError] = useState("");
  const id = useId();
  useEffect(() => {
    let current = true;
    void media.providers().then(
      (configs) => {
        if (current) setProviders(configs ?? {});
      },
      (e) => {
        if (current) setError(errorText(e));
      },
    );
    return () => {
      current = false;
    };
  }, []);
  const titles = {
    stt: zh ? "听写" : "Listen",
    tts: zh ? "朗读" : "Read",
    image: zh ? "插图" : "Illustrations",
  };
  const hints = {
    stt: zh ? "语音转文字" : "Speech to text",
    tts: zh ? "文字转语音" : "Text to speech",
    image: zh ? "从文字生成图片" : "Images from your words",
  };
  return (
    <div className="media-settings">
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      {providers && (
        <>
          <div
            className="media-capability-tabs"
            role="tablist"
            aria-label={zh ? "媒体功能" : "Media capabilities"}
          >
            {(["stt", "tts", "image"] as const).map((capability) => (
              <button
                type="button"
                role="tab"
                key={capability}
                id={`${id}-${capability}`}
                aria-controls={`${id}-panel-${capability}`}
                aria-selected={active === capability}
                tabIndex={active === capability ? 0 : -1}
                className={`media-capability-tab ${active === capability ? "is-selected" : ""}`}
                onClick={() => setActive(capability)}
                onKeyDown={(event) => {
                  const tabs = ["stt", "tts", "image"] as const;
                  let next: MediaCapability;
                  if (event.key === "ArrowRight")
                    next = tabs[(tabs.indexOf(capability) + 1) % tabs.length];
                  else if (event.key === "ArrowLeft")
                    next =
                      tabs[
                        (tabs.indexOf(capability) + tabs.length - 1) %
                          tabs.length
                      ];
                  else if (event.key === "Home") next = "stt";
                  else if (event.key === "End") next = "image";
                  else return;
                  event.preventDefault();
                  setActive(next);
                  document.getElementById(`${id}-${next}`)?.focus();
                }}
              >
                <span className="media-capability-title">
                  {titles[capability]}
                </span>
                <span className="media-capability-hint">
                  {hints[capability]}
                </span>
                <span className="media-capability-status">
                  {providers[capability]
                    ? (mediaPresets(capability).find(
                        (p) => p.id === providers[capability]?.provider,
                      )?.label ?? (zh ? "需要更新" : "Needs update"))
                    : capability === "stt"
                      ? zh
                        ? "系统 · 默认"
                        : "System · default"
                      : zh
                        ? "未启用"
                        : "Off"}
                </span>
              </button>
            ))}
          </div>
          {(["stt", "tts", "image"] as const).map((capability) => (
            <div
              role="tabpanel"
              id={`${id}-panel-${capability}`}
              aria-labelledby={`${id}-${capability}`}
              hidden={active !== capability}
              key={capability}
            >
              <MediaProviderForm
                capability={capability}
                initial={providers[capability]}
                language={language}
                onSaved={(config) =>
                  setProviders((current) => ({
                    ...current,
                    [capability]: config,
                  }))
                }
              />
            </div>
          ))}
          <p className="media-settings-note">
            {zh
              ? "仅在使用相应功能时连接所选服务，密钥安全保存在本机。"
              : "Connects to your chosen service when you use a media feature. Keys are stored privately on this device."}
          </p>
        </>
      )}
    </div>
  );
}
