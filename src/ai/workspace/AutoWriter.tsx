import { useEffect, useRef, useState } from "react";
import { ai } from "../../platform/ipc";
import { useSettings } from "../../settings/SettingsContext";
import { errorText } from "../../utils/error-text";
import { CloseIcon, ImageFileIcon } from "../../ui/icons";
import { quickText } from "./assist";
import type { AutoWriteRequest } from "./useProjectMaterial";
import {
  ensureIllustrated,
  parsePlan,
  pictureSrc,
  planMaterial,
  planningPrompt,
  sectionPrompt,
  type WritingPlan,
} from "./auto-writer";

/** What the editor lends the auto-writer: one Agent request at a time
 *  through the workspace (so every section is an ordinary reviewed draft),
 *  and the draft's accept / reject. */
export interface AutoWriterHost {
  docPath: string | null;
  busy: boolean;
  /** Sends one create-mode request; resolves once its proposals are in the
   *  draft. False when it could not be sent. */
  send: (message: string, allowImages: boolean) => Promise<boolean>;
  /** Changes waiting in the draft right now. */
  pending: () => number;
  /** The same, as of this render: a change decided in the draft (its
   *  全部采纳, a paragraph's ✓) re-renders the card. */
  pendingCount: number;
  /** How many times draft text has been accepted, by any button. */
  acceptedCount: () => number;
  acceptAll: () => void;
  rejectAll: () => void;
  stop: () => void;
}

type Phase =
  | "planning"
  | "failed"
  | "outline"
  | "writing"
  | "review"
  | "paused"
  | "done";
type SectionState = "todo" | "writing" | "review" | "done" | "skipped";

/** Auto-writing, started from the Agent's composer: a send in Create mode
 *  with project material picked (ProjectChip) - the folder, the ticked
 *  files and pictures, and the message as the extra requirements. The card
 *  plans the sections straight away, then shows the outline and each
 *  section's progress and review. */
export function AutoWriter({
  host,
  request,
  onClose,
}: {
  host: AutoWriterHost;
  request: AutoWriteRequest;
  onClose: () => void;
}) {
  const { settings } = useSettings();
  const zh = settings.language.startsWith("zh");
  const root = settings.agentWorkspaceRoot || null;
  const {
    folder,
    material,
    pictures,
    extra,
    images,
  } = request;
  // Asked at the outline, where the writing is about to start.
  const [eachSection, setEachSection] = useState(true);
  const [reading, setReading] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("planning");
  const [plan, setPlan] = useState<WritingPlan | null>(null);
  const [states, setStates] = useState<SectionState[]>([]);
  const [current, setCurrent] = useState(0);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pauseRequested = useRef(false);
  const hostRef = useRef(host);
  const idleWaiters = useRef<(() => void)[]>([]);
  useEffect(() => {
    hostRef.current = host;
    if (host.busy) return;
    const waiting = idleWaiters.current;
    idleWaiters.current = [];
    waiting.forEach((resolve) => resolve());
  });
  /** Resolves once a render has seen the previous request end: the host's
   *  send closes over that render's state and refuses while it says busy,
   *  so continuous mode cannot fire the next section straight away. */
  const hostIdle = () =>
    hostRef.current.busy
      ? new Promise<void>((resolve) => idleWaiters.current.push(resolve))
      : Promise.resolve();

  const makePlan = async () => {
    setError(null);
    setPhase("planning");
    try {
      // One at a time, saying which: a Word or PDF file takes a moment, and
      // one that can't be read is skipped rather than stopping the plan.
      const texts: { path: string; text: string }[] = [];
      for (const path of material) {
        setReading(path);
        const text = await ai
          .readProjectFile(host.docPath, root, path)
          .catch(() => null);
        if (text) texts.push({ path, text });
      }
      setReading(null);
      if (!texts.length && !extra.trim())
        throw new Error(
          zh
            ? "请写下要写什么，或在文件夹里勾选大纲和资料。"
            : "Say what to write, or tick an outline and material in the folder.",
        );
      const reply = await quickText(
        settings,
        "",
        planningPrompt(planMaterial(texts), extra, zh, images, pictures),
        crypto.randomUUID(),
      );
      const parsed = parsePlan(reply, pictures);
      const next = parsed && images ? ensureIllustrated(parsed) : parsed;
      if (!next)
        throw new Error(
          zh
            ? "没能从资料中规划出章节，请补充大纲或要求后重试。"
            : "No sections could be planned from the material; add an outline or requirements and retry.",
        );
      setPlan(next);
      setStates(next.sections.map(() => "todo"));
      setPhase("outline");
    } catch (err) {
      setReading(null);
      setError(errorText(err));
      setPhase("failed");
    }
  };
  // Planned as soon as the request arrives (once - StrictMode re-runs
  // effects, and a plan is a paid request).
  const planned = useRef<string | null>(null);
  useEffect(() => {
    if (planned.current === request.id) return;
    planned.current = request.id;
    void makePlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id]);

  const mark = (index: number, state: SectionState) =>
    setStates((prev) => prev.map((s, i) => (i === index ? state : s)));

  /** Writes section `index` (again, with `revision` notes) and either stops
   *  for review or, in continuous mode, accepts it and goes on. */
  const write = async (index: number, revision?: string) => {
    if (!plan) return;
    if (index >= plan.sections.length) {
      setPhase("done");
      return;
    }
    if (pauseRequested.current) {
      pauseRequested.current = false;
      setCurrent(index);
      setPhase("paused");
      return;
    }
    setError(null);
    setCurrent(index);
    setPhase("writing");
    mark(index, "writing");
    await hostIdle();
    // From here, any of this section's text taken counts - in the draft
    // while the Agent is still finishing its turn included.
    acceptedAtReview.current = hostRef.current.acceptedCount();
    const section = plan.sections[index];
    const sent = await hostRef.current.send(
      sectionPrompt(
        plan,
        index,
        {
          images,
          first: index === 0 && states.every((s) => s !== "done"),
          revision,
          pictureSrc:
            section.picture && folder
              ? pictureSrc(folder, section.picture, host.docPath)
              : undefined,
        },
        zh,
      ),
      images && section.image && !section.picture,
    );
    const takenAlready =
      hostRef.current.acceptedCount() > acceptedAtReview.current;
    if (sent && hostRef.current.pending() === 0 && takenAlready) {
      // Accepted before the request even ended: done, on to the next.
      mark(index, "done");
      void write(index + 1);
      return;
    }
    if (!sent || hostRef.current.pending() === 0) {
      mark(index, "todo");
      setError(
        zh
          ? "这一节没有得到可审阅的内容（请求失败或被停止）。可以重试或跳过。"
          : "This section produced nothing to review (the request failed or was stopped). Retry or skip it.",
      );
      setPhase("review");
      return;
    }
    if (eachSection) {
      mark(index, "review");
      setPhase("review");
      return;
    }
    hostRef.current.acceptAll();
    if (hostRef.current.pending() > 0) {
      // It could not go in (the document changed under it): stop here
      // rather than write the next section after a missing one.
      mark(index, "review");
      setError(
        zh
          ? "这一节没能写入文档（文档在写作期间被改动过）。可以在草稿里处理，或重写本节。"
          : "This section couldn't go into the document (it changed meanwhile). Decide it in the draft, or rewrite it.",
      );
      setPhase("review");
      return;
    }
    mark(index, "done");
    void write(index + 1);
  };

  // A section decided in the draft itself - 全部采纳 there, or every
  // paragraph taken or not - goes on like 采纳并继续 once any of it went
  // in. All of it rejected stays here: rewrite it, or skip it.
  const acceptedAtReview = useRef(0);
  // The section being written stays in view in a long outline.
  const outlineRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (phase !== "writing" && phase !== "review") return;
    outlineRef.current?.children[current]?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [current, phase]);
  useEffect(() => {
    if (phase !== "review" || error || host.pendingCount > 0) return;
    if (host.acceptedCount() <= acceptedAtReview.current) return;
    mark(current, "done");
    void write(current + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, host.pendingCount, error]);
  const acceptAndContinue = () => {
    if (hostRef.current.pending() > 0) hostRef.current.acceptAll();
    // Still waiting: it did not go in (the document was typed into since
    // it was written). Say so - moving on would leave a hole in the text.
    if (hostRef.current.pending() > 0) {
      setError(
        zh
          ? "这一节没能写入：文档在审阅期间被改动过。可以按意见重写本节，或跳过。"
          : "This section couldn't go in: the document was edited during review. Rewrite it or skip it.",
      );
      return;
    }
    mark(current, "done");
    void write(current + 1);
  };
  const reviseSection = () => {
    const notes = note.trim();
    if (!notes) return;
    setNote("");
    hostRef.current.rejectAll();
    void write(current, notes);
  };
  const skipSection = () => {
    hostRef.current.rejectAll();
    mark(current, "skipped");
    void write(current + 1);
  };
  const stopAll = () => {
    pauseRequested.current = false;
    hostRef.current.stop();
    setPhase("done");
  };

  const working = phase === "planning" || phase === "writing";
  const done = states.filter((s) => s === "done").length;
  const label = (key: string) =>
    (
      ({
        title: ["自动写作", "Auto-writing"],
        retry: ["重试", "Retry"],
        each: ["每写完一节暂停审阅", "Pause for review after each section"],
        planning: ["正在规划章节…", "Planning the sections…"],
        reading: ["正在读取", "Reading"],
        start: ["开始写作", "Start writing"],
        replan: ["重新规划", "Plan again"],
        writing: ["正在写作", "Writing"],
        review: [
          "这一节已写好。在草稿里采纳后会自动写下一节。",
          "This section is ready. Accept it in the draft and the next one starts.",
        ],
        accept: ["采纳并继续", "Accept and continue"],
        revise: ["按意见重写本节", "Rewrite this section"],
        note: [
          "修改意见，例如：更口语一些，加一个例子",
          "Notes, e.g. more conversational, add an example",
        ],
        skip: ["跳过本节", "Skip"],
        pause: ["暂停", "Pause"],
        resume: ["继续写作", "Continue"],
        stop: ["结束", "Stop"],
        done: ["写作完成", "Finished"],
        close: ["关闭", "Close"],
        picture: ["本节配图", "Picture for this section"],
        noPicture: ["不配图", "No picture"],
        generate: ["AI 生成", "Generate"],
        aiPicture: ["AI 配图", "AI picture"],
      }) as Record<string, [string, string]>
    )[key][zh ? 0 : 1];

  return (
    <section className="auto-writer" aria-label={label("title")}>
      <header>
        <strong>✦ {label("title")}</strong>
        {plan && (
          <span className="auto-writer-progress">
            {done}/{plan.sections.length}
          </span>
        )}
        <button
          type="button"
          className="auto-writer-close"
          aria-label={label("close")}
          disabled={working}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>

      {extra.trim() && (
        <p className="auto-writer-request" title={extra}>
          {extra}
        </p>
      )}

      {phase === "planning" && (
        <p className="auto-writer-status">
          <span className="auto-writer-spinner" aria-hidden />
          {reading
            ? `${label("reading")} ${reading.split("/").pop()}…`
            : label("planning")}
        </p>
      )}

      {plan && phase !== "planning" && phase !== "failed" && (
        <>
          {plan.title && <p className="auto-writer-doc-title">{plan.title}</p>}
          <ol
            ref={outlineRef}
            className={`auto-writer-outline${phase === "outline" ? "" : " is-running"}`}
          >
            {plan.sections.map((section, i) => (
              <li key={i} className={`is-${states[i]}`}>
                <span className="auto-writer-mark" aria-hidden />
                <span className="auto-writer-section">
                  {phase === "outline" ? (
                    <input
                      value={section.title}
                      onChange={(e) =>
                        setPlan({
                          ...plan,
                          sections: plan.sections.map((s, j) =>
                            j === i ? { ...s, title: e.target.value } : s,
                          ),
                        })
                      }
                    />
                  ) : (
                    <strong>{section.title}</strong>
                  )}
                  {section.brief && <small>{section.brief}</small>}
                </span>
                {phase === "outline" && (pictures.length > 0 || images) ? (
                  <select
                    className="auto-writer-picture"
                    aria-label={label("picture")}
                    title={label("picture")}
                    value={
                      section.picture ?? (section.image ? "@generate" : "")
                    }
                    onChange={(e) => {
                      const value = e.target.value;
                      setPlan({
                        ...plan,
                        sections: plan.sections.map((s, j) =>
                          j === i
                            ? {
                                ...s,
                                image: value === "@generate",
                                picture:
                                  value && value !== "@generate"
                                    ? value
                                    : undefined,
                              }
                            : s,
                        ),
                      });
                    }}
                  >
                    <option value="">{label("noPicture")}</option>
                    {images && (
                      <option value="@generate">{label("generate")}</option>
                    )}
                    {pictures.map((path) => (
                      <option key={path} value={path}>
                        {path.split("/").pop()}
                      </option>
                    ))}
                  </select>
                ) : (
                  (section.picture || (images && section.image)) && (
                    <span className="auto-writer-picture-tag">
                      <ImageFileIcon />
                      <span>
                        {section.picture
                          ? section.picture.split("/").pop()
                          : label("aiPicture")}
                      </span>
                    </span>
                  )
                )}
                {phase === "outline" && (
                  <button
                    type="button"
                    className="auto-writer-remove"
                    aria-label={zh ? "删除这一节" : "Remove section"}
                    onClick={() => {
                      setPlan({
                        ...plan,
                        sections: plan.sections.filter((_, j) => j !== i),
                      });
                      setStates((prev) => prev.filter((_, j) => j !== i));
                    }}
                  >
                    <CloseIcon />
                  </button>
                )}
              </li>
            ))}
          </ol>
        </>
      )}

      {phase === "outline" && (
        <div className="auto-writer-actions">
          <label className="auto-writer-option auto-writer-each">
            <input
              type="checkbox"
              className="ui-check"
              checked={eachSection}
              onChange={(e) => setEachSection(e.target.checked)}
            />
            {label("each")}
          </label>
          <button type="button" onClick={() => void makePlan()}>
            {label("replan")}
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={host.busy || !plan?.sections.length}
            onClick={() => void write(0)}
          >
            {label("start")}
          </button>
        </div>
      )}

      {phase === "writing" && (
        <div className="auto-writer-actions">
          <p className="auto-writer-status">
            <span className="auto-writer-spinner" aria-hidden />
            {label("writing")} · {plan?.sections[current]?.title}
          </p>
          {!eachSection && (
            <button
              type="button"
              onClick={() => {
                pauseRequested.current = true;
              }}
            >
              {label("pause")}
            </button>
          )}
          <button type="button" className="is-quiet" onClick={stopAll}>
            {label("stop")}
          </button>
        </div>
      )}

      {phase === "review" && (
        <div className="auto-writer-review">
          {error ? (
            <p className="auto-writer-error" role="alert">
              {error}
            </p>
          ) : (
            <p>{label("review")}</p>
          )}
          <div className="auto-writer-revise">
            <input
              value={note}
              placeholder={label("note")}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing)
                  reviseSection();
              }}
            />
            <button
              type="button"
              disabled={!note.trim() || host.busy}
              onClick={reviseSection}
            >
              {label("revise")}
            </button>
          </div>
          <div className="auto-writer-actions">
            <button type="button" className="is-quiet" onClick={stopAll}>
              {label("stop")}
            </button>
            <button type="button" onClick={skipSection} disabled={host.busy}>
              {label("skip")}
            </button>
            {error ? (
              <button
                type="button"
                className="is-primary"
                disabled={host.busy}
                onClick={() => void write(current)}
              >
                {zh ? "重试本节" : "Retry"}
              </button>
            ) : (
              <button
                type="button"
                className="is-primary"
                disabled={host.busy}
                onClick={acceptAndContinue}
              >
                {label("accept")}
              </button>
            )}
          </div>
        </div>
      )}

      {phase === "paused" && (
        <div className="auto-writer-actions">
          <button type="button" className="is-quiet" onClick={stopAll}>
            {label("stop")}
          </button>
          <button
            type="button"
            className="is-primary"
            onClick={() => void write(current)}
          >
            {label("resume")}
          </button>
        </div>
      )}

      {phase === "done" && (
        <div className="auto-writer-actions">
          <p className="auto-writer-status">✓ {label("done")}</p>
          <button type="button" onClick={onClose}>
            {label("close")}
          </button>
        </div>
      )}

      {phase === "failed" && (
        <div className="auto-writer-review">
          <p className="auto-writer-error" role="alert">
            {error}
          </p>
          <div className="auto-writer-actions">
            <button type="button" className="is-quiet" onClick={onClose}>
              {label("close")}
            </button>
            <button
              type="button"
              className="is-primary"
              onClick={() => void makePlan()}
            >
              {label("retry")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
