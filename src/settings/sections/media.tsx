import { useEffect, useState } from "react";
import {
  media,
  type MediaCapability,
  type MediaProviderConfig,
  type MediaProviders,
} from "../../platform/ipc";
import { errorText } from "../../utils/error-text";
import { Select } from "../../ui/Select";

function MediaProviderForm({
  capability,
  initial,
  language,
}: {
  capability: MediaCapability;
  initial?: MediaProviderConfig;
  language: string;
}) {
  const zh = language.startsWith("zh");
  const title = {
    stt: zh ? "语音转文字" : "Speech to text",
    tts: zh ? "文字朗读" : "Text to speech",
    image: zh ? "图片生成" : "Image generation",
  }[capability];
  const [config, setConfig] = useState<MediaProviderConfig>(
    initial ?? {
      provider: "openai-compatible",
      endpoint: "",
      model: "",
      voice: capability === "tts" ? "alloy" : null,
    },
  );
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => {
    void media
      .keyStatus(capability)
      .then(setHasKey)
      .catch(() => {});
  }, [capability]);
  async function save() {
    setBusy(true);
    setStatus("");
    try {
      if (key.trim()) {
        await media.setKey(capability, key.trim());
        setKey("");
        setHasKey(true);
      }
      await media.configure(capability, config);
      setStatus(zh ? "已保存" : "Saved");
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="media-provider-settings">
      <summary>{title}</summary>
      <form
        aria-label={title}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="settings-row">
          <span>{zh ? "接口协议" : "API protocol"}</span>
          <Select
            value={config.provider}
            onChange={(event) =>
              setConfig({
                ...config,
                provider: event.target.value as MediaProviderConfig["provider"],
              })
            }
          >
            <option value="openai-compatible">OpenAI-compatible</option>
            <option value="openai">OpenAI</option>
          </Select>
        </label>
        <label className="settings-row">
          <span>{zh ? "API 基础地址" : "API base URL"}</span>
          <input
            className="settings-text-input"
            type="url"
            required
            placeholder="https://api.example.com/v1"
            value={config.endpoint}
            onChange={(e) => setConfig({ ...config, endpoint: e.target.value })}
          />
        </label>
        <label className="settings-row">
          <span>{zh ? "模型" : "Model"}</span>
          <input
            className="settings-text-input"
            required
            value={config.model}
            onChange={(e) => setConfig({ ...config, model: e.target.value })}
          />
        </label>
        {capability === "tts" && (
          <label className="settings-row">
            <span>
              {zh
                ? "音色（服务支持的名称）"
                : "Voice (supported by your provider)"}
            </span>
            <input
              className="settings-text-input"
              required
              value={config.voice ?? ""}
              onChange={(e) => setConfig({ ...config, voice: e.target.value })}
            />
          </label>
        )}
        <label className="settings-row">
          <span>API Key {hasKey && "✓"}</span>
          <input
            className="settings-text-input"
            type="password"
            autoComplete="off"
            value={key}
            placeholder={
              zh ? "兼容服务可留空" : "Optional for compatible services"
            }
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <div className="settings-row">
          <button type="submit" disabled={busy}>
            {zh ? "保存" : "Save"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void media.configure(capability, null).then(
                () => setStatus(zh ? "已停用" : "Disabled"),
                (e) => setStatus(errorText(e)),
              );
            }}
          >
            {zh ? "停用服务" : "Disable provider"}
          </button>
          {hasKey && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void media.clearKey(capability).then(
                  () => setHasKey(false),
                  (e) => setStatus(errorText(e)),
                );
              }}
            >
              {zh ? "清除 Key" : "Clear key"}
            </button>
          )}
        </div>
        <p className="settings-row-hint">
          {zh
            ? "仅在主动使用时向此服务发送录音、朗读文本或图片提示词，可能产生费用。与聊天模型分开配置。"
            : "Only explicit use sends recording audio, speech text or image prompts to this service and may incur charges. Configured separately from chat."}
        </p>
        {status && <p role="status">{status}</p>}
      </form>
    </details>
  );
}

export function MediaSettings({ language }: { language: string }) {
  const [providers, setProviders] = useState<MediaProviders | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void media.providers().then(
      (configs) => setProviders(configs ?? {}),
      (e) => {
        setError(errorText(e));
        setProviders({});
      },
    );
  }, []);
  return (
    <div className="media-settings">
      {error && <p role="alert">{error}</p>}
      {providers &&
        (["stt", "image", "tts"] as const).map((capability) => (
          <MediaProviderForm
            key={capability}
            capability={capability}
            initial={providers[capability]}
            language={language}
          />
        ))}
    </div>
  );
}
