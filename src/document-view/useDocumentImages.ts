import { useCallback, useEffect, useRef, useState } from "react";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import {
  media,
  type ImageGenerationRequest,
  type ImageJob,
  type ImageTaskPermission,
} from "../platform/ipc";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { useDocumentWorkspace } from "./useDocumentWorkspace";
import {
  buildAnchoredTransaction,
  buildDraftTransaction,
} from "../ai/workspace/document-draft";
import { imageMarkdown } from "../ai/multimodal/image-proposal";
import { parseMarkdownSource } from "../editor/markdown/parse-markdown-source";
import { errorText } from "../utils/error-text";
import { findMarkdownMatch, serializeBlocks } from "../ai/doc-markdown";
import {
  imagePlaceholderKey,
  placeholderActions,
  type ImagePlaceholder,
} from "../ai/multimodal/image-placeholder-plugin";

/** A frame for a picture that is not a job yet: its prompt being written,
 *  or waiting for the user's approval (useSelectionIllustration). */
interface HeldFrame {
  id: string;
  anchor: string;
  status: "refining" | "review";
  editing?: boolean;
  prompt?: string;
  actions?: { id: string; label: string; primary?: boolean }[];
  handlers?: Record<string, () => void>;
}
import { useLatest } from "../utils/hooks/useLatest";

export function useDocumentImages(
  run: EditorRunner,
  documentId: string,
  path: string | null,
  workspace: ReturnType<typeof useDocumentWorkspace>,
  sessionId: string,
  language = "en",
) {
  const zh = language.startsWith("zh");
  const [jobs, setJobs] = useState<ImageJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inserting, setInserting] = useState<string | null>(null);
  const [starts, setStarts] = useState(0);
  const [unsettled, setUnsettled] = useState(0);
  const awaiting = useRef(new Set<string>());
  const cancelRef = useRef<(jobId: string) => Promise<void>>(async () => {});
  const authorizations = useRef(new Map<string, ImageTaskPermission>());
  const stopped = useRef(new Set<string>());
  /** Jobs from an explicit right-click: inserted against the live document. */
  const liveJobs = useRef(new Set<string>());
  /** Agent tasks whose text was accepted: their pictures go in by anchor
   *  like right-click ones (the anchor only existed in the draft before). */
  const adoptedTasks = useRef(new Set<string>());
  const [adoptions, setAdoptions] = useState(0);
  const inPlace = (job: ImageJob) =>
    liveJobs.current.has(job.jobId) || adoptedTasks.current.has(job.taskId);
  /** Its anchor is in the document now (not only in a pending draft). */
  const anchorLive = useCallback(
    (job: ImageJob) =>
      !!run((ctx) =>
        findMarkdownMatch(
          serializeBlocks(ctx, ctx.get(editorViewCtx).state.doc),
          job.request.anchor,
        ),
      ),
    [run],
  );
  /** Pictures the user skipped in the draft: kept, not cancelled, so they
   *  can still be taken ("万一后悔") - never inserted by themselves. */
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const insertingRef = useRef<string | null>(null);
  const alive = useRef(true);
  const latest = useLatest({ workspace, path, sessionId, jobs });
  // A picture set aside (skipped, or its text rejected) waits on nobody: it
  // must not hold the Agent's draft open as work in progress.
  const pending =
    starts > 0 ||
    unsettled > 0 ||
    jobs.some(
      (j) =>
        !["committed", "cancelled", "failed"].includes(j.status) &&
        !(j.status === "ready" && skipped.has(j.jobId)),
    );
  const setMediaPending = workspace.setMediaPending;
  useEffect(() => {
    setMediaPending(pending);
  }, [pending, setMediaPending]);
  const refresh = useCallback(async () => {
    try {
      const value = (await media.imageJobs(documentId)) ?? [];
      // Polled while a job runs: keep the old array when nothing changed so
      // the whole editor tree does not re-render on every tick.
      if (alive.current)
        setJobs((prev) =>
          prev.length === value.length &&
          prev.every(
            (job, i) =>
              job.jobId === value[i].jobId &&
              job.status === value[i].status &&
              job.assetSrc === value[i].assetSrc &&
              job.error === value[i].error &&
              job.previewPath === value[i].previewPath,
          )
            ? prev
            : value,
        );
      return true;
    } catch (err) {
      if (alive.current) setError(errorText(err));
      return false;
    }
  }, [documentId]);
  const settle = useCallback(async () => {
    const ids = [...awaiting.current];
    if (!ids.length) return;
    if (await refresh()) {
      for (const id of ids) awaiting.current.delete(id);
      if (alive.current) setUnsettled(awaiting.current.size);
    }
  }, [refresh]);
  useEffect(() => {
    alive.current = true;
    const ownedGenerations = authorizations.current;
    void refresh();
    return () => {
      alive.current = false;
      // Only for good: an effect that is merely re-run (a hot reload, a
      // re-render that re-creates `refresh`) sets `alive` again before
      // this runs, and must not cancel the pictures still painting.
      setTimeout(() => {
        if (alive.current) return;
        for (const permission of ownedGenerations.values())
          void media.cancelImageGeneration(permission).catch(() => {});
      }, 0);
    };
  }, [refresh]);
  /** Frames for pictures not yet queued (a prompt still being refined). */
  const [held, setHeld] = useState<HeldFrame[]>([]);
  const holdPlaceholder = useCallback(
    (
      anchor: string,
      status: "refining" | "review" = "refining",
      details: Pick<
        HeldFrame,
        "prompt" | "actions" | "handlers" | "editing"
      > = {},
    ) => {
      const id = crypto.randomUUID();
      setHeld((prev) => [...prev, { id, anchor, status, ...details }]);
      // The id names the frame's editor container (data-placeholder-editor).
      return Object.assign(
        () => {
          placeholderActions.delete(id);
          setHeld((prev) => prev.filter((p) => p.id !== id));
        },
        { id },
      );
    },
    [],
  );
  // A shimmering frame under each anchor while its picture is generated.
  useEffect(() => {
    const active = [
      ...held.map((h) => ({
        jobId: h.id,
        status: h.status as string,
        request: { anchor: h.anchor, size: "1024x1024", prompt: h.prompt },
        actions: h.actions,
        handlers: h.handlers,
        editing: h.editing,
      })),
      ...jobs.filter((job) =>
        ["queued", "running", "preparing"].includes(job.status),
      ),
    ];
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const current = imagePlaceholderKey.getState(view.state);
      if (!active.length && !current?.find().length) return;
      const blocks = active.length ? serializeBlocks(ctx, view.state.doc) : [];
      const placeholders: ImagePlaceholder[] = [];
      for (const job of active) {
        const match = findMarkdownMatch(blocks, job.request.anchor);
        if (!match) {
          // Its paragraph was edited away: a waiting prompt is withdrawn
          // rather than left invisible and unanswerable.
          if ("handlers" in job)
            queueMicrotask(() => job.handlers?.missing?.());
          continue;
        }
        const [w, h] = (job.request.size ?? "1024x1024").split("x").map(Number);
        const isHeld = "handlers" in job;
        // A queued or painting job can be cancelled from its frame.
        const actions = isHeld
          ? job.actions
          : job.status === "preparing"
            ? []
            : [{ id: "cancel", label: zh ? "取消" : "Cancel" }];
        placeholderActions.set(
          job.jobId,
          isHeld
            ? (job.handlers ?? {})
            : { cancel: () => void cancelRef.current(job.jobId) },
        );
        placeholders.push({
          id: job.jobId,
          pos: match.to,
          ratio: w > 0 && h > 0 ? w / h : 1,
          queued: job.status === "queued" || job.status === "review",
          review: job.status === "review",
          editing: "editing" in job && job.editing === true,
          prompt: job.status === "refining" ? undefined : job.request.prompt,
          actions,
          anchor: job.request.anchor,
          meta: job.request.size ?? undefined,
          label:
            (zh
              ? {
                  queued: "排队中",
                  refining: "构思中",
                  review: "待确认",
                  preparing: "正在插入",
                  running: "正在绘制",
                }
              : {
                  queued: "Queued",
                  refining: "Composing",
                  review: "Awaiting approval",
                  preparing: "Inserting",
                  running: "Painting",
                })[job.status as "queued"] ?? (zh ? "正在绘制" : "Painting"),
        });
      }
      view.dispatch(
        view.state.tr
          .setMeta(imagePlaceholderKey, placeholders)
          .setMeta("addToHistory", false),
      );
    });
    // `adoptions`: accepted Agent text brings its pictures' anchors in.
  }, [jobs, held, run, zh, adoptions]);
  const running = jobs.some((job) =>
    ["queued", "running", "preparing"].includes(job.status),
  );
  useEffect(() => {
    if (!running) return;
    // An interval, not a timeout re-armed by `jobs`: refresh keeps the same
    // array while nothing changed, which would otherwise end the polling.
    const timer = setInterval(() => {
      void refresh();
    }, 750);
    return () => clearInterval(timer);
  }, [running, refresh]);
  const authorizeTask = useCallback(
    (taskId: string, baseRevision: number): ImageTaskPermission => {
      const permission = {
        taskId,
        documentId,
        baseRevision,
        allowAutomatic: true,
        generationId: crypto.randomUUID(),
      };
      authorizations.current.set(permission.generationId, permission);
      awaiting.current.add(permission.generationId);
      setUnsettled(awaiting.current.size);
      return permission;
    },
    [documentId],
  );
  const start = useCallback(
    async (
      request: ImageGenerationRequest,
      options: { live?: boolean } = {},
    ) => {
      const { workspace: w, sessionId: session } = latest.current;
      let taskId: string;
      let revision: number;
      if (options.live) {
        // Its own task: one illustration never spends another task's quota.
        taskId = crypto.randomUUID();
        revision = 0;
      } else {
        if (!w.begin("edit", session)) return;
        // begin() only captured the draft; no model exchange is routed here.
        w.endRouting();
        const draft = w.currentDraft();
        if (!draft) return;
        taskId = draft.id;
        revision = draft.baseRevision;
      }
      const permission = authorizeTask(taskId, revision);
      setStarts((count) => count + 1);
      try {
        const job = await media.startImage(permission, request);
        if (alive.current && !stopped.current.has(permission.generationId)) {
          if (options.live) liveJobs.current.add(job.jobId);
          setJobs((prev) => [
            ...prev.filter((j) => j.jobId !== job.jobId),
            job,
          ]);
          setError(null);
          return job;
        }
      } catch (err) {
        if (alive.current) setError(errorText(err));
      } finally {
        awaiting.current.delete(permission.generationId);
        if (alive.current) setUnsettled(awaiting.current.size);
        if (alive.current) setStarts((count) => count - 1);
      }
    },
    [authorizeTask, latest],
  );
  const cancel = useCallback(
    async (jobId: string) => {
      try {
        await media.cancelImage(jobId);
        await refresh();
      } catch (err) {
        if (alive.current) setError(errorText(err));
      }
    },
    [refresh],
  );
  useEffect(() => {
    cancelRef.current = cancel;
  }, [cancel]);
  const canAccept = useCallback(
    (job: ImageJob) =>
      !latest.current.jobs.some(
        (previous) =>
          previous.taskId === job.taskId &&
          previous.request.anchor === job.request.anchor &&
          previous.sequence < job.sequence &&
          ["queued", "running", "ready", "preparing", "prepared"].includes(
            previous.status,
          ),
      ),
    [latest],
  );
  const accept = useCallback(
    async (job: ImageJob) => {
      if (job.status !== "ready" || insertingRef.current || !canAccept(job))
        return false;
      const options = { live: inPlace(job) || anchorLive(job) };
      const { workspace: w, path: docPath, jobs: currentJobs } = latest.current;
      const captured = w.currentDraft();
      // A live (explicit right-click) insertion only needs its anchor.
      const draft = options.live
        ? {
            ...(captured ?? {
              documentId,
              sessionId: "",
              baseRevision: 0,
              baseMarkdown: "",
              selection: { from: 0, to: 0 },
              operations: [],
            }),
            id: job.taskId,
          }
        : captured;
      if (!draft || draft.id !== job.taskId) {
        setError(
          zh
            ? "图片目标属于另一个任务，请在当前位置重新生成。"
            : "Image target is from a different task. Start a new image proposal at the current document location.",
        );
        return false;
      }
      const previous = currentJobs
        .filter(
          (p) =>
            p.taskId === job.taskId &&
            p.request.anchor === job.request.anchor &&
            p.sequence < job.sequence &&
            p.status === "committed" &&
            p.assetSrc,
        )
        .sort((a, b) => b.sequence - a.sequence)[0];
      const build = (src: string) =>
        run((ctx) => {
          const state = ctx.get(editorViewCtx).state;
          let anchor = job.request.anchor;
          // A picture follows its whole paragraph: anchored to a sentence
          // inside one, it used to land mid-paragraph, inline in the text.
          if (options.live && !previous?.assetSrc) {
            const block = findMarkdownMatch(
              serializeBlocks(ctx, state.doc),
              anchor,
            );
            if (block) anchor = block.markdown;
          }
          if (previous?.assetSrc) {
            const parsed = parseMarkdownSource(
              ctx,
              imageMarkdown(previous.assetSrc, previous.request),
            );
            if (!parsed) return null;
            anchor = ctx.get(serializerCtx)(parsed).trim();
          }
          return (
            options.live ? buildAnchoredTransaction : buildDraftTransaction
          )(ctx, state, {
            ...draft,
            operations: [
              {
                callId: job.jobId,
                proposal: {
                  action: "insert_after",
                  anchor,
                  text: imageMarkdown(src, job.request),
                },
              },
            ],
          });
        });
      if (!build("assets/pending-image.png")) {
        setError(
          zh
            ? "插图位置所在的段落已更改，请重新生成。"
            : "The document revision or image anchor changed. Relocate the image with a new proposal.",
        );
        return false;
      }
      insertingRef.current = job.jobId;
      setInserting(job.jobId);
      setError(null);
      let prepared = false;
      let committed = false;
      try {
        const src = await media.prepareImage(job.jobId, docPath);
        prepared = true;
        if (!alive.current || latest.current.path !== docPath)
          throw new Error(
            zh
              ? "保存图片时文档位置发生变化，已回滚。"
              : "The document location changed while saving the image. Its prepared asset was rolled back.",
          );
        const tr = build(src);
        if (!tr)
          throw new Error(
            zh
              ? "保存图片时文档已更改，已回滚。"
              : "The document changed while saving the image. Its prepared asset was rolled back.",
          );
        run((ctx) => ctx.get(editorViewCtx).dispatch(tr));
        committed = true;
        w.rebaseAfterCommit(tr);
        await media.finishImage(job.jobId, true);
        await refresh();
        return true;
      } catch (err) {
        if (prepared && !committed) {
          try {
            await media.finishImage(job.jobId, false);
          } catch (rollback) {
            setError(`${errorText(err)} ${errorText(rollback)}`);
            return false;
          }
        }
        if (alive.current) setError(errorText(err));
        return false;
      } finally {
        insertingRef.current = null;
        if (alive.current) setInserting(null);
        if (committed) void refresh();
      }
    },
    [run, canAccept, latest, refresh, documentId, zh, anchorLive],
  );
  // Right-click and refined pictures go straight under their paragraph when
  // ready, and so do the Agent's - asked for with the image switch, so no
  // second approval - once their anchor is in the document (text from a
  // draft: when it is accepted). One that cannot (its paragraph changed)
  // falls back to the job list for a manual decision.
  const acceptRef = useRef<typeof accept | null>(null);
  useEffect(() => {
    acceptRef.current = accept;
  }, [accept]);
  const [stuck, setStuck] = useState<ReadonlySet<string>>(new Set());
  const autoInserting = useRef<string | null>(null);
  useEffect(() => {
    const ready = jobs.find(
      (job) =>
        job.status === "ready" &&
        !stuck.has(job.jobId) &&
        !skipped.has(job.jobId) &&
        // An adopted task's picture whose paragraph is still in the draft
        // (only part of it accepted) waits for it rather than failing.
        anchorLive(job) &&
        (inPlace(job) ||
          // Started in this session (not one left from before a restart).
          authorizations.current.has(job.generationId ?? "")),
    );
    if (!ready || autoInserting.current) return;
    autoInserting.current = ready.jobId;
    void acceptRef.current?.(ready).then((ok) => {
      autoInserting.current = null;
      if (!ok) setStuck((prev) => new Set(prev).add(ready.jobId));
    });
    // inPlace reads refs; `adoptions` re-runs this when a task is adopted.
  }, [jobs, stuck, skipped, adoptions, anchorLive]);
  const stopRunning = useCallback(async () => {
    const permissions = new Map(authorizations.current);
    for (const job of latest.current.jobs)
      if (job.generationId)
        permissions.set(job.generationId, {
          taskId: job.taskId,
          documentId,
          generationId: job.generationId,
          baseRevision: job.baseRevision,
          allowAutomatic: true,
        });
    for (const id of permissions.keys()) stopped.current.add(id);
    try {
      await Promise.all(
        [...permissions.values()].map((permission) =>
          media.cancelImageGeneration(permission),
        ),
      );
      for (const id of permissions.keys()) authorizations.current.delete(id);
      for (const id of permissions.keys()) awaiting.current.delete(id);
      if (alive.current) setUnsettled(awaiting.current.size);
      await refresh();
    } catch (err) {
      if (alive.current) setError(errorText(err));
      throw err;
    }
  }, [documentId, latest, refresh]);
  /** A new picture for the same place from an adjusted prompt: the old
   *  job is dropped, the new one is anchored like a right-click illustration
   *  (its own quota, inserted against the live document once reviewed). */
  const regenerate = useCallback(
    async (job: ImageJob, prompt: string) => {
      await cancel(job.jobId);
      return start({ ...job.request, prompt }, { live: true });
    },
    [cancel, start],
  );
  const isLive = useCallback(
    (jobId: string) => {
      const job = jobs.find((j) => j.jobId === jobId);
      return (
        (liveJobs.current.has(jobId) ||
          (!!job && adoptedTasks.current.has(job.taskId))) &&
        !stuck.has(jobId) &&
        !skipped.has(jobId)
      );
    },
    // `adoptions`: adoptedTasks is a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobs, stuck, skipped, adoptions],
  );
  const waitsForDraft = useCallback(
    (job: ImageJob) => {
      const draft = latest.current.workspace.currentDraft();
      return (
        draft?.id === job.taskId &&
        draft.operations.length > 0 &&
        !anchorLive(job)
      );
    },
    [latest, anchorLive],
  );
  const skip = useCallback((jobId: string) => {
    setSkipped((prev) => new Set(prev).add(jobId));
  }, []);
  const unskip = useCallback((jobId: string) => {
    setSkipped((prev) => {
      const next = new Set(prev);
      next.delete(jobId);
      return next;
    });
  }, []);
  return {
    jobs,
    regenerate,
    /** Its paragraph is in the document now. */
    anchorLive,
    skipped,
    skip,
    unskip,
    /** Right-click illustrations: shown in their frame, not the job list. */
    isLive,
    /** The Agent's draft holding this picture's anchor was accepted. */
    adoptTask: (taskId: string) => {
      adoptedTasks.current.add(taskId);
      setAdoptions((n) => n + 1);
    },
    /** Its paragraph is still only in the pending draft. */
    waitsForDraft,
    error,
    inserting,
    start,
    authorizeTask,
    settle,
    accept,
    cancel,
    canAccept,
    refresh,
    stopRunning,
    pending,
    holdPlaceholder,
  };
}
