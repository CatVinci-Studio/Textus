import { useCallback, useEffect, useRef, useState } from "react";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import {
  media,
  type ImageGenerationRequest,
  type ImageJob,
} from "../platform/ipc";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { useDocumentWorkspace } from "./useDocumentWorkspace";
import { buildDraftTransaction } from "../ai/workspace/document-draft";
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
) {
  const [jobs, setJobs] = useState<ImageJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inserting, setInserting] = useState<string | null>(null);
  const insertingRef = useRef<string | null>(null);
  const alive = useRef(true);
  const latest = useLatest({ workspace, path, sessionId, jobs });
  const pending = jobs.some(
    (j) => !["committed", "cancelled"].includes(j.status),
  );
  const setMediaPending = workspace.setMediaPending;
  useEffect(() => {
    setMediaPending(pending);
  }, [pending, setMediaPending]);
  const refresh = useCallback(async () => {
    try {
      const value = await media.imageJobs(documentId);
      if (alive.current) setJobs(value ?? []);
    } catch (err) {
      if (alive.current) setError(errorText(err));
    }
  }, [documentId]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (
      !jobs.some((job) =>
        ["queued", "running", "preparing"].includes(job.status),
      )
    )
      return;
    const timer = setTimeout(() => {
      void refresh();
    }, 750);
    return () => clearTimeout(timer);
  }, [jobs, refresh]);
  const start = useCallback(
    async (request: ImageGenerationRequest) => {
      const { workspace: w, sessionId: session } = latest.current;
      if (!w.begin("edit", session)) return;
      const draft = w.currentDraft();
      if (!draft) return;
      try {
        const job = await media.startImage(
          {
            taskId: draft.id,
            documentId,
            baseRevision: draft.baseRevision,
            allowAutomatic: true,
          },
          request,
        );
        if (alive.current) {
          setJobs((prev) => [
            ...prev.filter((j) => j.jobId !== job.jobId),
            job,
          ]);
          setError(null);
        }
      } catch (err) {
        if (alive.current) setError(errorText(err));
      }
    },
    [documentId, latest],
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
        return;
      const { workspace: w, path: docPath, jobs: currentJobs } = latest.current;
      const draft = w.currentDraft();
      if (!draft || draft.id !== job.taskId) {
        setError(
          "Image target is from a different task. Start a new image proposal at the current document location.",
        );
        return;
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
          return buildDraftTransaction(ctx, state, {
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
          "The document revision or image anchor changed. Relocate the image with a new proposal.",
        );
        return;
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
            "The document location changed while saving the image. Its prepared asset was rolled back.",
          );
        const tr = build(src);
        if (!tr)
          throw new Error(
            "The document changed while saving the image. Its prepared asset was rolled back.",
          );
        run((ctx) => ctx.get(editorViewCtx).dispatch(tr));
        committed = true;
        w.rebaseAfterCommit();
        await media.finishImage(job.jobId, true);
        await refresh();
      } catch (err) {
        if (prepared && !committed) {
          try {
            await media.finishImage(job.jobId, false);
          } catch (rollback) {
            setError(`${errorText(err)} ${errorText(rollback)}`);
            return;
          }
        }
        if (alive.current) setError(errorText(err));
      } finally {
        insertingRef.current = null;
        if (alive.current) setInserting(null);
      }
    },
    [run, canAccept, latest, refresh],
  );
  const stopRunning = useCallback(() => {
    for (const job of latest.current.jobs)
      if (["queued", "running"].includes(job.status)) void cancel(job.jobId);
  }, [cancel, latest]);
  return {
    jobs,
    error,
    inserting,
    start,
    accept,
    cancel,
    canAccept,
    refresh,
    stopRunning,
    pending,
  };
}
