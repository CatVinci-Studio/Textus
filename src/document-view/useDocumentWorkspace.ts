import { useCallback, useMemo, useRef, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { StreamEvent } from "../platform/ipc";
import type { AgentMode } from "../settings/SettingsContext";
import type { PendingStatus } from "../ai/revision/usePendingEdits";
import { ProposalStream } from "../ai/revision/proposal-stream";
import { isRefusal } from "../ai/revision/proposal-status";
import { parseProposal } from "../ai/chat/proposal";
import {
  buildDraftTransaction,
  captureDraft,
  previewDraft,
  type DocumentDraft,
  type DraftOperation,
} from "../ai/workspace/document-draft";

/** The editor owns both surfaces. Only accepted drafts dispatch transactions. */
export function useDocumentWorkspace(run: EditorRunner, documentId: string) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DocumentDraft | null>(null);
  const draftRef = useRef<DocumentDraft | null>(null);
  const routing = useRef(false);
  const mode = useRef<AgentMode>("ask");
  const [conflict, setConflict] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, PendingStatus>>({});
  const update = useCallback((next: DocumentDraft | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);
  const receive = useCallback(
    (operations: DraftOperation[]) => {
      if (!routing.current) return false;
      if (mode.current !== "create" && mode.current !== "edit") return true;
      const current = draftRef.current;
      if (current) {
        const next = [...current.operations];
        for (const op of operations) {
          const index = next.findIndex((o) => o.callId === op.callId);
          if (index < 0) next.push(op);
          else next[index] = op;
        }
        update({ ...current, operations: next });
      }
      return true;
    },
    [update],
  );
  const discard = useCallback(
    (callId?: string) => {
      const current = draftRef.current;
      if (!current) return;
      const removed = current.operations.filter(
        (o) => !callId || o.callId === callId,
      );
      setStatuses((prev) => ({
        ...prev,
        ...Object.fromEntries(
          removed.map((o) => [o.callId, "rejected" as const]),
        ),
      }));
      update({
        ...current,
        operations: current.operations.filter(
          (o) => callId && o.callId !== callId,
        ),
      });
      setConflict(false);
    },
    [update],
  );
  const stream = useMemo(
    () =>
      new ProposalStream({
        place: (callId, proposal) => {
          receive([{ callId, proposal }]);
        },
        feed: (callId, text) => {
          const op = draftRef.current?.operations.find(
            (o) => o.callId === callId,
          );
          if (op) receive([{ callId, proposal: { ...op.proposal, text } }]);
        },
        finalize: (callId, proposal) => {
          receive([{ callId, proposal }]);
        },
        discard: (callId) => discard(callId),
      }),
    [receive, discard],
  );
  const begin = useCallback(
    (nextMode: AgentMode, sessionId: string) => {
      routing.current = true;
      mode.current = nextMode;
      if (!draftRef.current?.operations.length) {
        const next = run((ctx) =>
          captureDraft(
            ctx,
            ctx.get(editorViewCtx).state,
            documentId,
            sessionId,
          ),
        );
        if (!next) return false;
        update(next);
        setConflict(false);
      }
      return true;
    },
    [run, documentId, update],
  );
  const onEvent = useCallback(
    (event: StreamEvent) => {
      if (!routing.current) return false;
      if (event.type === "toolStart")
        stream.toolStart(event.callId, event.name);
      if (event.type === "toolArgsDelta")
        stream.argsDelta(event.callId, event.delta);
      if (
        event.type === "turn" &&
        event.turn.kind === "ToolCall" &&
        event.turn.name === "propose_edit"
      ) {
        stream.finalCall(event.turn.call_id, event.turn.arguments);
        const proposal = parseProposal(event.turn.arguments);
        if (proposal) receive([{ callId: event.turn.call_id, proposal }]);
      }
      if (
        event.type === "turn" &&
        event.turn.kind === "ToolResult" &&
        isRefusal(event.turn.output)
      )
        discard(event.turn.call_id);
      return true;
    },
    [stream, receive, discard],
  );
  const accept = useCallback(
    (callId?: string) => {
      const current = draftRef.current;
      if (!current) return false;
      const operations = current.operations.filter(
        (o) => !callId || o.callId === callId,
      );
      const ok =
        run((ctx) => {
          const view = ctx.get(editorViewCtx);
          const tr = buildDraftTransaction(ctx, view.state, {
            ...current,
            operations,
          });
          if (!tr) return false;
          view.dispatch(tr);
          // Rebase remaining proposals onto the exact document just committed.
          update({
            ...captureDraft(ctx, view.state, documentId, current.sessionId),
            id: current.id,
            operations: current.operations.filter(
              (o) => !operations.includes(o),
            ),
          });
          return true;
        }) ?? false;
      setConflict(!ok);
      if (ok)
        setStatuses((prev) => ({
          ...prev,
          ...Object.fromEntries(
            operations.map((o) => [o.callId, "accepted" as const]),
          ),
        }));
      return ok;
    },
    [run, documentId, update],
  );
  const preview = useMemo(
    () =>
      draft
        ? (run((ctx) =>
            previewDraft(ctx, ctx.get(editorViewCtx).state, draft),
          ) ?? draft.baseMarkdown)
        : "",
    [draft, run],
  );
  const finish = useCallback(() => stream.finish("stopped"), [stream]);
  const endRouting = useCallback(() => {
    routing.current = false;
  }, []);
  const restore = useCallback(
    (restored: DocumentDraft) => {
      if (draftRef.current) return;
      update(restored);
      setConflict(restored.baseRevision < 0);
    },
    [update],
  );
  return {
    open,
    setOpen,
    draft,
    preview,
    conflict,
    begin,
    onEvent,
    receive,
    accept,
    discard,
    statuses,
    finish,
    endRouting,
    restore,
  };
}
