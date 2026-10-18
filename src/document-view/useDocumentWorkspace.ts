import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Transaction } from "@milkdown/kit/prose/state";
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
  rebaseDraftAfterTransaction,
  previewDraft,
  type DocumentDraft,
  type DraftOperation,
} from "../ai/workspace/document-draft";

/** The editor owns both surfaces. Only accepted drafts dispatch transactions. */
export function useDocumentWorkspace(
  run: EditorRunner,
  documentId: string,
  initialOpen = false,
) {
  const [open, setOpen] = useState(initialOpen);
  const [draft, setDraft] = useState<DocumentDraft | null>(null);
  const draftRef = useRef<DocumentDraft | null>(null);
  const routing = useRef(false);
  const mediaPending = useRef(false);
  const mode = useRef<AgentMode>("ask");
  const [conflict, setConflict] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, PendingStatus>>({});
  const frame = useRef<ReturnType<typeof setTimeout> | null>(null);
  const update = useCallback((next: DocumentDraft | null) => {
    draftRef.current = next;
    if (frame.current) clearTimeout(frame.current);
    frame.current = null;
    setDraft(next);
  }, []);
  /** Streamed argument chunks arrive dozens of times a second; each render
   *  re-parses the whole document for the preview, so coalesce them. The ref
   *  stays exact for every reader in between. */
  const updateSoon = useCallback((next: DocumentDraft) => {
    draftRef.current = next;
    frame.current ??= setTimeout(() => {
      frame.current = null;
      setDraft(draftRef.current);
    }, 90);
  }, []);
  useEffect(
    () => () => {
      if (frame.current) clearTimeout(frame.current);
    },
    [],
  );
  const receive = useCallback(
    (operations: DraftOperation[], streaming = false) => {
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
        (streaming ? updateSoon : update)({ ...current, operations: next });
      }
      return true;
    },
    [update, updateSoon],
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
      const operations = current.operations.filter(
        (o) => callId && o.callId !== callId,
      );
      update({ ...current, operations });
      // Skipping one change does not resolve a conflict on the others.
      setConflict(!!current.conflicted && operations.length > 0);
    },
    [update],
  );
  const stream = useMemo(
    () =>
      new ProposalStream({
        place: (callId, proposal) => {
          receive([{ callId, proposal }], true);
        },
        feed: (callId, text) => {
          const op = draftRef.current?.operations.find(
            (o) => o.callId === callId,
          );
          if (op)
            receive([{ callId, proposal: { ...op.proposal, text } }], true);
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
      if (
        !draftRef.current ||
        (!draftRef.current.operations.length && !mediaPending.current)
      ) {
        const next = run((ctx) =>
          captureDraft(
            ctx,
            ctx.get(editorViewCtx).state,
            documentId,
            sessionId,
          ),
        );
        if (!next) return false;
        const previous = draftRef.current;
        update({
          ...next,
          id: previous?.sessionId === sessionId ? previous.id : next.id,
        });
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
          const rebased = rebaseDraftAfterTransaction(
            ctx,
            view.state,
            {
              ...current,
              operations: current.operations.filter(
                (o) => !operations.includes(o),
              ),
            },
            tr,
          );
          update(rebased);
          setConflict(!!rebased.conflicted);
          return true;
        }) ?? false;
      if (!ok) setConflict(true);
      if (ok)
        setStatuses((prev) => ({
          ...prev,
          ...Object.fromEntries(
            operations.map((o) => [o.callId, "accepted" as const]),
          ),
        }));
      return ok;
    },
    [run, update],
  );
  // Only the visible Agent surface shows the preview.
  const preview = useMemo(
    () =>
      draft && open && draft.operations.length
        ? (run((ctx) =>
            previewDraft(ctx, ctx.get(editorViewCtx).state, draft),
          ) ?? draft.baseMarkdown)
        : "",
    [draft, run, open],
  );
  const finish = useCallback(
    (outcome: "stopped" | "failed" = "stopped") => {
      stream.finish(outcome);
      // The exchange is over: later proposals (detached chat, Quick Ask)
      // must not be captured into this workspace draft.
      routing.current = false;
    },
    [stream],
  );
  const endRouting = useCallback(() => {
    routing.current = false;
  }, []);
  const restore = useCallback(
    (restored: DocumentDraft) => {
      if (draftRef.current) return;
      update(restored);
      setConflict(!!restored.conflicted || restored.baseRevision < 0);
    },
    [update],
  );
  const currentDraft = useCallback(() => draftRef.current, []);
  const setMediaPending = useCallback((pending: boolean) => {
    mediaPending.current = pending;
  }, []);
  const rebaseAfterCommit = useCallback(
    (tr: Transaction) => {
      const current = draftRef.current;
      if (current)
        run((ctx) => {
          const next = rebaseDraftAfterTransaction(
            ctx,
            ctx.get(editorViewCtx).state,
            current,
            tr,
          );
          update(next);
          setConflict(!!next.conflicted);
        });
    },
    [run, update],
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
    currentDraft,
    setMediaPending,
    rebaseAfterCommit,
  };
}
