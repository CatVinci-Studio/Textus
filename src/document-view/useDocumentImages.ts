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
  const authorizations = useRef(new Map<string, ImageTaskPermission>());
  const stopped = useRef(new Set<string>());
  /** Jobs from an explicit right-click: inserted against the live document. */
  const liveJobs = useRef(new Set<string>());
  const insertingRef = useRef<string | null>(null);
  const alive = useRef(true);
  const latest = useLatest({ workspace, path, sessionId, jobs });
  const pending =
    starts > 0 ||
    unsettled > 0 ||
    jobs.some((j) => !["committed", "cancelled", "failed"].includes(j.status));
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
      for (const permission of ownedGenerations.values())
        void media.cancelImageGeneration(permission).catch(() => {});
    };
  }, [refresh]);
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
      const options = { live: liveJobs.current.has(job.jobId) };
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
    [run, canAccept, latest, refresh, documentId, zh],
  );
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
  return {
    jobs,
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
  };
}
