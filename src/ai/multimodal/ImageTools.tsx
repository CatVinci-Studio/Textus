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
import { PromptRefiner } from "./PromptRefiner";
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

/** One picture in progress: thumbnail, status, the prompt it is made from,
 *  where it goes, and what can be done with it. */
function ImageJobCard({
  job,
  images,
  zh,
  onRefine,
}: {
  job: ImageJob;
  images: ReturnType<typeof useDocumentImages>;
  zh: boolean;
  onRefine: (job: ImageJob) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = {
    queued: zh ? "排队中" : "Queued",
    running: zh ? "正在绘制" : "Painting",
    ready: zh ? "待插入" : "Ready to insert",
    failed: zh ? "生成失败" : "Failed",
    prepared: zh ? "正在插入" : "Inserting",
    preparing: zh ? "正在保存" : "Saving",
    cancelled: zh ? "已取消" : "Cancelled",
    committed: zh ? "已插入" : "Inserted",
  }[job.status];
  const working = ["queued", "running", "prepared", "preparing"].includes(
    job.status,
  );
  return (
    <article className={`image-job is-${job.status}`}>
      <div className="image-job-thumb">
        {job.previewPath && job.status === "ready" ? (
          <img src={convertFileSrc(job.previewPath)} alt={job.request.alt} />
        ) : job.status === "failed" ? (
          <span className="image-job-thumb-icon" aria-hidden>
            !
          </span>
        ) : (
          <span className="image-job-shimmer" aria-hidden />
        )}
      </div>
      <div className="image-job-body">
        <div className="image-job-head">
          <span className={`image-job-status is-${job.status}`} role="status">
            <span className="image-job-dot" aria-hidden />
            {status}
          </span>
          <span className="image-job-meta">
            {[
              job.model,
              job.width && job.height
                ? `${job.width}×${job.height}`
                : job.request.size,
              `${job.sequence}/2`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        <p
          className={`image-job-prompt${expanded ? " is-expanded" : ""}`}
          title={zh ? "生成提示词" : "Generation prompt"}
          onClick={() => setExpanded((v) => !v)}
        >
          {job.request.prompt}
        </p>
        <p className="image-job-anchor" title={job.request.anchor}>
          <span aria-hidden>↳</span> {job.request.anchor}
        </p>
        {job.error && (
          <p className="image-job-error" role="alert">
            {job.error}
          </p>
        )}
        <div className="image-job-actions">
          {images.waitsForDraft(job) && (
            <span className="image-job-wait">
              {zh
                ? "采纳正文后自动插入到对应段落"
                : "Inserted below its paragraph once the text is accepted"}
            </span>
          )}
          {job.status === "ready" && !images.waitsForDraft(job) && (
            <button
              type="button"
              className="is-primary"
              disabled={!!images.inserting || !images.canAccept(job)}
              onClick={() => {
                void images.accept(job);
              }}
            >
              {zh ? "插入图片" : "Insert"}
            </button>
          )}
          {["ready", "failed"].includes(job.status) && (
            <button type="button" onClick={() => onRefine(job)}>
              {zh ? "调整提示词" : "Adjust prompt"}
            </button>
          )}
          {job.status === "failed" && (
            <button
              type="button"
              onClick={() => {
                void images.regenerate(job, job.request.prompt);
              }}
            >
              {zh ? "重试" : "Retry"}
            </button>
          )}
          {!["prepared", "preparing"].includes(job.status) && (
            <button
              type="button"
              className="is-quiet"
              onClick={() => {
                void images.cancel(job.jobId);
              }}
            >
              {working ? (zh ? "取消" : "Cancel") : zh ? "跳过" : "Skip"}
            </button>
          )}
        </div>
      </div>
    </article>
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
  const [refining, setRefining] = useState<ImageJob | null>(null);
  // Right-click pictures live in their frame in the document.
  const visible = images.jobs.filter(
    (job) =>
      !["cancelled", "committed"].includes(job.status) &&
      !images.isLive(job.jobId),
  );
  if (!visible.length && !images.error && !refining) return null;
  return (
    <div className="image-jobs">
      {images.error && (
        <p className="image-job-error" role="alert">
          {images.error}
        </p>
      )}
      {visible.map((job) => (
        <ImageJobCard
          key={job.jobId}
          job={job}
          images={images}
          zh={zh}
          onRefine={setRefining}
        />
      ))}
      {refining && (
        <PromptRefiner
          prompt={refining.request.prompt}
          anchor={refining.request.anchor}
          onClose={() => setRefining(null)}
          onRegenerate={(prompt) => {
            const job = refining;
            setRefining(null);
            void images.regenerate(job, prompt);
          }}
        />
      )}
    </div>
  );
}
