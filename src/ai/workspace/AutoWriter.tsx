import { useEffect, useRef, useState } from "react";
import { ai, type ProjectEntry } from "../../platform/ipc";
import { useSettings } from "../../settings/SettingsContext";
import { errorText } from "../../utils/error-text";
import { CloseIcon } from "../../ui/icons";
import { quickText } from "./assist";
import { ProjectFiles } from "./ProjectFiles";
import {
  ensureIllustrated,
  looksLikePlanFile,
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
  acceptAll: () => void;
  rejectAll: () => void;
  stop: () => void;
}

type Phase =
  "setup" | "planning" | "outline" | "writing" | "review" | "paused" | "done";
type SectionState = "todo" | "writing" | "review" | "done" | "skipped";

export function AutoWriter({
  host,
  onClose,
}: {
  host: AutoWriterHost;
  onClose: () => void;
}) {
  const { settings, setSettings } = useSettings();
  const zh = settings.language.startsWith("zh");
  const root = settings.agentWorkspaceRoot || null;
  // The folder in use (the chosen one, else the document's own) and all of
  // its files; ticked text/documents are material, ticked pictures are
  // offered to the sections.
  const [folder, setFolder] = useState<string | null>(null);
  const [entries, setEntries] = useState<ProjectEntry[] | null>(null);
  const [reload, setReload] = useState(0);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState<string | null>(null);
  const [extra, setExtra] = useState("");
  const [eachSection, setEachSection] = useState(true);
  const [images, setImages] = useState(false);
  const [phase, setPhase] = useState<Phase>("setup");
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

  // The project's files: plan-like documents and the pictures start ticked.
  useEffect(() => {
    let live = true;
    setEntries(null);
    void Promise.all([
      ai.projectFolder(host.docPath, root).catch(() => null),
      ai.listProjectEntries(host.docPath, root).catch(() => []),
    ]).then(([dir, list]) => {
      if (!live) return;
      setFolder(dir);
      setEntries(dir ? (list ?? []) : []);
      setChosen(
        new Set(
          (list ?? [])
            .filter(
              (e) =>
                (e.kind !== "image" && looksLikePlanFile(e.path)) ||
                e.kind === "image",
            )
            .slice(0, 60)
            .map((e) => e.path),
        ),
      );
    });
    return () => {
      live = false;
    };
  }, [host.docPath, root, reload]);
  const kindOf = (path: string) =>
    entries?.find((e) => e.path === path)?.kind ?? "other";
  const material = [...chosen].filter(
    (p) => kindOf(p) === "text" || kindOf(p) === "document",
  );
  const pictures = [...chosen].filter((p) => kindOf(p) === "image");

  const pickFolder = async () => {
    const picked = await ai.pickWorkspaceRoot().catch(() => null);
    if (picked) setSettings({ agentWorkspaceRoot: picked });
  };

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
            ? "请至少勾选一个规划文件，或写下写作要求。"
            : "Choose at least one plan file or write your requirements.",
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
      setPhase("setup");
    }
  };

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
    mark(index, "done");
    void write(index + 1);
  };

  const acceptAndContinue = () => {
    if (hostRef.current.pending() > 0) hostRef.current.acceptAll();
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
        intro: [
          "勾选项目文件夹里的大纲、要求和资料（文本、Word、PDF），AI 先规划章节再逐节写作，每一节都是待审阅的草稿；勾选的图片会用在合适的章节。",
          "Tick the outline, requirements and material (text, Word, PDF) in the project folder: the AI plans the sections and writes them one by one, each a draft for review; ticked pictures go into the sections they fit.",
        ],
        extra: [
          "补充要求（可选）：主题、读者、篇幅、文风……",
          "Further requirements (optional): topic, readers, length, tone…",
        ],
        each: ["每写完一节暂停审阅", "Pause for review after each section"],
        images: [
          "为合适的章节配图（会调用图片服务）",
          "Illustrate suitable sections (uses the image service)",
        ],
        plan: ["规划章节", "Plan sections"],
        planning: ["正在规划章节…", "Planning the sections…"],
        reading: ["正在读取", "Reading"],
        start: ["开始写作", "Start writing"],
        replan: ["重新规划", "Plan again"],
        writing: ["正在写作", "Writing"],
        review: [
          "这一节已写好，请在右侧草稿中审阅。",
          "This section is ready - review it in the draft on the right.",
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

      {phase === "setup" && (
        <>
          <p className="auto-writer-intro">{label("intro")}</p>
          <ProjectFiles
            root={folder}
            entries={entries}
            selected={chosen}
            zh={zh}
            onToggle={(paths, on) =>
              setChosen((prev) => {
                const next = new Set(prev);
                for (const path of paths) {
                  if (on) next.add(path);
                  else next.delete(path);
                }
                return next;
              })
            }
            onOpenFolder={() => void pickFolder()}
            onRefresh={() => setReload((n) => n + 1)}
          />
          <textarea
            rows={2}
            value={extra}
            placeholder={label("extra")}
            onChange={(e) => setExtra(e.target.value)}
          />
          <label className="auto-writer-option">
            <input
              type="checkbox"
              className="ui-check"
              checked={eachSection}
              onChange={(e) => setEachSection(e.target.checked)}
            />
            {label("each")}
          </label>
          <label className="auto-writer-option">
            <input
              type="checkbox"
              className="ui-check"
              checked={images}
              onChange={(e) => setImages(e.target.checked)}
            />
            {label("images")}
          </label>
          <div className="auto-writer-actions">
            <button
              type="button"
              className="is-primary"
              disabled={host.busy || (!material.length && !extra.trim())}
              onClick={() => void makePlan()}
            >
              {label("plan")}
            </button>
          </div>
        </>
      )}

      {phase === "planning" && (
        <p className="auto-writer-status">
          <span className="auto-writer-spinner" aria-hidden />
          {reading
            ? `${label("reading")} ${reading.split("/").pop()}…`
            : label("planning")}
        </p>
      )}

      {plan && phase !== "setup" && phase !== "planning" && (
        <>
          {plan.title && <p className="auto-writer-doc-title">{plan.title}</p>}
          <ol className="auto-writer-outline">
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
                      {section.picture
                        ? section.picture.split("/").pop()
                        : label("generate")}
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
          <button type="button" onClick={() => setPhase("setup")}>
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

      {error && phase === "setup" && (
        <p className="auto-writer-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
