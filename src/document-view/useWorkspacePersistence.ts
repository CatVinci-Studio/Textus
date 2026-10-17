import { useEffect, useRef, useState } from "react";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { useDocumentWorkspace } from "./useDocumentWorkspace";
import type { AgentConversation } from "../ai/chat/useAgentConversation";
import { useChatHistory } from "../ai/chat/chat-history";
import {
  loadWorkspace,
  persistWorkspace,
  rebaseRestoredDraft,
} from "../ai/workspace/draft-store";
import { documentRevisionKey } from "../ai/workspace/revision-plugin";
import { onFlush } from "../storage/pending-writes";
import { useLatest } from "../utils/hooks/useLatest";
import { registerWorkspaceClose } from "../document/workspace-close";
import { showConfirm } from "../ui/app-dialog";

export function useWorkspacePersistence({
  workspace,
  conversation,
  run,
  documentId,
  tabId,
  path,
  enabled,
  language,
  imagePending,
  stopImages,
}: {
  workspace: ReturnType<typeof useDocumentWorkspace>;
  conversation: AgentConversation;
  run: EditorRunner;
  documentId: string;
  tabId: string;
  path: string | null;
  enabled: boolean;
  language: string;
  imagePending: boolean;
  stopImages: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const history = useLatest(useChatHistory());
  const latest = useLatest({
    workspace,
    conversation,
    path,
    imagePending,
    stopImages,
  });
  const loadStarted = useRef(false);
  useEffect(() => {
    if (!enabled) {
      setLoaded(true);
      return;
    }
    if (loadStarted.current) return;
    loadStarted.current = true;
    let cancelled = false;
    let frame = 0;
    void loadWorkspace(documentId)
      .then((snapshot) => {
        if (!snapshot || cancelled) {
          if (!cancelled) setLoaded(true);
          return;
        }
        const restoreWhenReady = () => {
          if (cancelled) return;
          const restored = run((ctx) => {
            const state = ctx.get(editorViewCtx).state;
            const rebased = rebaseRestoredDraft(
              snapshot.draft,
              ctx.get(serializerCtx)(state.doc),
              documentRevisionKey.getState(state) ?? 0,
            );
            latest.current.workspace.restore(
              rebased ?? { ...snapshot.draft, baseRevision: -1 },
            );
            const entry = history.current.find(
              (e) => e.id === snapshot.draft.sessionId,
            );
            if (
              entry &&
              !latest.current.conversation.busy &&
              !latest.current.conversation.history.length
            )
              latest.current.conversation.restore(entry.id, entry.turns);
            setInterrupted(snapshot.status === "interrupted");
            setLoaded(true);
            return true;
          });
          if (!restored) frame = requestAnimationFrame(restoreWhenReady);
        };
        restoreWhenReady();
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      loadStarted.current = false;
    };
  }, [enabled, documentId, run, latest, history]);

  useEffect(() => {
    if (!enabled || !loaded) return;
    const save = () => {
      clearTimeout(timer);
      const {
        workspace: w,
        conversation: c,
        path: currentPath,
      } = latest.current;
      const draft = w.draft;
      const snapshot =
        draft &&
        (draft.operations.length || c.busy || latest.current.imagePending)
          ? {
              schemaVersion: 1 as const,
              documentId,
              tabId,
              documentPath: currentPath,
              draft,
              updatedAt: Date.now(),
              status: c.busy ? ("running" as const) : ("review" as const),
            }
          : null;
      void persistWorkspace(snapshot, documentId).then(
        () => setError(null),
        (err) => setError(String(err)),
      );
    };
    const timer = setTimeout(save, 250);
    const unlisten = onFlush(save);
    return () => {
      clearTimeout(timer);
      unlisten();
    };
  }, [
    workspace.draft,
    conversation.busy,
    imagePending,
    path,
    enabled,
    loaded,
    documentId,
    tabId,
    latest,
  ]);
  useEffect(
    () =>
      registerWorkspaceClose(tabId, async (reason) => {
        const {
          workspace: w,
          conversation: c,
          path: currentPath,
        } = latest.current;
        if (
          !w.draft?.operations.length &&
          !c.busy &&
          !latest.current.imagePending
        )
          return true;
        const zh = language.startsWith("zh");
        if (reason === "handoff" && !enabled) {
          setError(
            zh
              ? "请先处理创作草稿，或启用草稿恢复后再移动标签页。"
              : "Resolve the Agent draft or enable draft recovery before moving this tab.",
          );
          return false;
        }
        const keep =
          reason === "handoff" ||
          (await showConfirm(
            zh
              ? enabled
                ? "此文档有未处理的 Agent 草稿或正在运行的任务。关闭将停止任务，并保留草稿供恢复。"
                : "此文档有未处理的 Agent 草稿或任务，草稿恢复已关闭。关闭将停止任务并丢弃草稿。"
              : enabled
                ? "This document has a pending Agent draft or running task. Closing stops the task and keeps the draft for recovery."
                : "Draft recovery is off. Closing stops the task and discards the pending draft.",
            {
              title: zh ? "未处理的创作任务" : "Pending document task",
              okLabel: zh
                ? enabled
                  ? "保留草稿并关闭"
                  : "丢弃并关闭"
                : enabled
                  ? "Keep draft and close"
                  : "Discard and close",
              cancelLabel: zh ? "取消" : "Cancel",
            },
          ));
        if (!keep) return false;
        if (c.busy) c.stop();
        latest.current.stopImages();
        w.finish();
        const frozen = w.currentDraft();
        if (enabled && frozen) {
          try {
            await persistWorkspace(
              {
                schemaVersion: 1,
                documentId,
                tabId,
                documentPath: currentPath,
                updatedAt: Date.now(),
                status: c.busy ? "interrupted" : "review",
                draft: frozen,
              },
              documentId,
            );
          } catch (err) {
            setError(String(err));
            return false;
          }
        }
        return true;
      }),
    [tabId, documentId, enabled, language, latest],
  );
  return { loaded, error, interrupted };
}
