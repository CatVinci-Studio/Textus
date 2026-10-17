import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  media,
  type ImageGenerationRequest,
  type ImageJob,
  type MediaProviderConfig,
} from "../../platform/ipc";
import type { useDocumentImages } from "../../document-view/useDocumentImages";
import { errorText } from "../../utils/error-text";
import "./images.css";

export function ImageGenerator({
  language,
  defaultAnchor,
  onGenerate,
  disabled,
}: {
  language: string;
  defaultAnchor: () => string;
  onGenerate: (request: ImageGenerationRequest) => Promise<void>;
  disabled?: boolean;
}) {
  const zh = language.startsWith("zh");
  const [prompt, setPrompt] = useState("");
  const [anchor, setAnchor] = useState("");
  const [alt, setAlt] = useState("");
  const [caption, setCaption] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [provider, setProvider] = useState<MediaProviderConfig | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <details
      className="image-generator"
      onToggle={(e) => {
        if (e.currentTarget.open) {
          if (!anchor) setAnchor(defaultAnchor());
          void media.providers().then(
            (p) => setProvider(p?.image ?? null),
            (err) => setError(errorText(err)),
          );
        }
      }}
    >
      <summary>{zh ? "生成配图" : "Generate illustration"}</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void onGenerate({
            prompt,
            anchor,
            alt: alt || prompt.slice(0, 120),
            caption: caption || null,
            size,
          }).finally(() => setBusy(false));
        }}
      >
        <p>
          {zh
            ? "发送图片提示词到所配置服务，可能产生费用。每任务最多两次请求，结果需确认后插入。"
            : "Sends the prompt to your configured image service and may incur charges. Up to two requests per task; insertion requires review."}
        </p>
        {!provider && (
          <p>
            {zh
              ? "请在设置 → Textus AI → 多模态服务中配置图片生成。"
              : "Configure image generation in Settings > Textus AI > Media providers."}
          </p>
        )}
        {provider && (
          <small>
            {provider.endpoint} · {provider.model}
          </small>
        )}
        <label>
          {zh ? "图片描述" : "Image prompt"}
          <textarea
            required
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>
        <label>
          {zh
            ? "插入位置（唯一标题或段落原文）"
            : "Insert after (unique heading or paragraph quote)"}
          <textarea
            required
            value={anchor}
            onChange={(e) => setAnchor(e.target.value)}
          />
        </label>
        <label>
          {zh ? "替代文本" : "Alternative text"}
          <input value={alt} onChange={(e) => setAlt(e.target.value)} />
        </label>
        <label>
          {zh ? "图注" : "Caption"}
          <input value={caption} onChange={(e) => setCaption(e.target.value)} />
        </label>
        <label>
          {zh ? "尺寸" : "Size"}
          <select value={size} onChange={(e) => setSize(e.target.value)}>
            <option>1024x1024</option>
            <option>1536x1024</option>
            <option>1024x1536</option>
          </select>
        </label>
        <button disabled={disabled || busy || !provider} type="submit">
          {zh ? "生成图片" : "Generate image"}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
  );
}

export function ImageJobsPanel({
  language,
  images,
}: {
  language: string;
  images: ReturnType<typeof useDocumentImages>;
}) {
  const zh = language.startsWith("zh");
  const visible = images.jobs.filter(
    (job) => !["cancelled", "committed"].includes(job.status),
  );
  const label = (job: ImageJob) =>
    ({
      queued: zh ? "排队中" : "Queued",
      running: zh ? "正在生成" : "Generating",
      ready: zh ? "待确认" : "Ready for review",
      failed: zh ? "生成失败" : "Failed",
      prepared: zh ? "正在提交" : "Committing",
      preparing: zh ? "正在保存资源" : "Saving asset",
      cancelled: "Cancelled",
      committed: "Committed",
    })[job.status];
  return (
    <div className="image-jobs">
      {images.error && <p role="alert">{images.error}</p>}
      {visible.map((job) => (
        <article className="image-job" key={job.jobId}>
          <strong>{job.request.alt}</strong>
          <span role="status">
            {label(job)} · {job.sequence}/2
          </span>
          <p>{job.request.anchor}</p>
          {job.previewPath && job.status === "ready" && (
            <img src={convertFileSrc(job.previewPath)} alt={job.request.alt} />
          )}
          {job.request.caption && <p>{job.request.caption}</p>}
          {job.error && <p role="alert">{job.error}</p>}
          <details>
            <summary>{zh ? "生成详情" : "Generation details"}</summary>
            <p>{job.request.prompt}</p>
            <small>
              {job.model} {job.width && `${job.width}×${job.height}`}
            </small>
          </details>
          {job.status === "ready" && (
            <button
              type="button"
              disabled={!!images.inserting || !images.canAccept(job)}
              onClick={() => {
                void images.accept(job);
              }}
            >
              {zh ? "插入图片" : "Insert image"}
            </button>
          )}
          {job.status === "failed" && (
            <button
              type="button"
              onClick={() => {
                void images
                  .cancel(job.jobId)
                  .then(() => images.start(job.request));
              }}
            >
              {zh ? "重试" : "Retry"}
            </button>
          )}
          {!["prepared", "preparing"].includes(job.status) && (
            <button
              type="button"
              onClick={() => {
                void images.cancel(job.jobId);
              }}
            >
              {zh
                ? job.status === "ready"
                  ? "跳过"
                  : "取消"
                : job.status === "ready"
                  ? "Skip"
                  : "Cancel"}
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
