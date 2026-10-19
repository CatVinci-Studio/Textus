import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import type { Transaction } from "@milkdown/kit/prose/state";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { StreamEvent } from "../platform/ipc";
import type { AgentMode } from "../settings/SettingsContext";
import type { PendingStatus } from "../ai/revision/usePendingEdits";
import { ProposalStream } from "../ai/revision/proposal-stream";
import { isRefusal } from "../ai/revision/proposal-status";
import { parseProposal } from "../ai/chat/proposal";
import { parseMarkdownSource } from "../editor/markdown/parse-markdown-source";
import { documentRevisionKey } from "../ai/workspace/revision-plugin";
import { serializeBlocks } from "../ai/doc-markdown";
import type { EditProposal } from "../ai/types";
import {
  buildDraftTransaction,
  captureDraft,
  rebaseDraftAfterTransaction,
  previewDraft,
  type DocumentDraft,
  type DraftOperation,
} from "../ai/workspace/document-draft";

/** The one action whose paragraphs stand on their own: text added at the
 *  end. An insertion next to a sentence lands inside its paragraph, so its
 *  "paragraphs" ran together into one when taken apart; a rewrite would
 *  put one paragraph in place of its whole passage. */
const SPLITTABLE_ACTIONS = new Set(["append"]);

/** Whether `op` is change `callId` - itself, or one of its paragraphs once
 *  split (explode). No id: every change. */
function belongs(op: DraftOperation, callId?: string) {
  return !callId || op.callId === callId || op.parent === callId;
}

/** Puts `op` back among `operations` in its change's order: after the last
 *  earlier part of the same change, else before the first later one. */
function insertInOrder(operations: DraftOperation[], op: DraftOperation) {
  const rest = operations.filter((o) => o.callId !== op.callId);
  if (op.parent === undefined || op.part === undefined) return [...rest, op];
  let at = -1;
  rest.forEach((o, i) => {
    if (o.parent === op.parent && (o.part ?? 0) < op.part!) at = i;
  });
  if (at < 0) {
    const later = rest.findIndex(
      (o) => o.parent === op.parent && (o.part ?? 0) > op.part!,
    );
    if (later >= 0) return [...rest.slice(0, later), op, ...rest.slice(later)];
    return [...rest, op];
  }
  return [...rest.slice(0, at + 1), op, ...rest.slice(at + 1)];
}

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
  /** Changes whose text is still arriving: never decided half-written. The
   *  rest can be, while the Agent keeps working (a check, its report). */
  const streamingIds = useRef(new Set<string>());
  /** Changes already decided (taken, turned down, refused) or split into
   *  paragraphs: the exchange's own later copy of one - its final turn
   *  arriving after a decision made while the Agent was still talking -
   *  must not put it back. It did, and the text went in twice. */
  const closedIds = useRef(new Set<string>());
  const settledOp = (o: DraftOperation) =>
    !streamingIds.current.has(o.callId) &&
    !(o.parent && streamingIds.current.has(o.parent));
  /** This task's rejected changes, kept so the user can take one after all
   *  (reinstate) - the change list shows them with 采纳. */
  const [rejected, setRejected] = useState<DraftOperation[]>([]);
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
      // A whole proposal (not a streamed piece) has finished arriving.
      if (!streaming)
        for (const op of operations) streamingIds.current.delete(op.callId);
      operations = operations.filter((op) => !closedIds.current.has(op.callId));
      if (!operations.length) return true;
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
    (
      callId?: string,
      /** False for a call the backend refused or a stream that broke off:
       *  never a proposal the user turned down, so nothing to take back. */
      restorable = true,
    ) => {
      const current = draftRef.current;
      if (!current) return;
      // A refused or broken-off stream goes whole; the user's 拒绝 leaves
      // a change still being written alone.
      const removed = current.operations.filter(
        (o) => belongs(o, callId) && (!restorable || settledOp(o)),
      );
      for (const o of removed) closedIds.current.add(o.callId);
      if (restorable && removed.length)
        setRejected((prev) => [
          ...prev.filter((o) => !removed.some((r) => r.callId === o.callId)),
          ...removed,
        ]);
      setStatuses((prev) => ({
        ...prev,
        ...Object.fromEntries(
          removed.map((o) => [o.callId, "rejected" as const]),
        ),
      }));
      const operations = current.operations.filter((o) => !removed.includes(o));
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
          streamingIds.current.add(callId);
          receive([{ callId, proposal }], true);
        },
        feed: (callId, text, done) => {
          if (done) streamingIds.current.delete(callId);
          const op = draftRef.current?.operations.find(
            (o) => o.callId === callId,
          );
          if (op)
            receive([{ callId, proposal: { ...op.proposal, text } }], true);
        },
        finalize: (callId, proposal) => {
          streamingIds.current.delete(callId);
          receive([{ callId, proposal }]);
        },
        discard: (callId) => {
          streamingIds.current.delete(callId);
          discard(callId, false);
        },
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
        const sameTask = previous?.sessionId === sessionId;
        update({
          ...next,
          id: sameTask ? previous.id : next.id,
        });
        // Another conversation's rejections are not this one's to take.
        if (!sameTask) setRejected([]);
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
        streamingIds.current.delete(event.turn.call_id);
        const proposal = parseProposal(event.turn.arguments);
        if (proposal) receive([{ callId: event.turn.call_id, proposal }]);
      }
      if (
        event.type === "turn" &&
        event.turn.kind === "ToolResult" &&
        isRefusal(event.turn.output)
      )
        discard(event.turn.call_id, false);
      return true;
    },
    [stream, receive, discard],
  );
  const accept = useCallback(
    (callId?: string) => {
      const current = draftRef.current;
      if (!current) return false;
      const operations = current.operations.filter(
        (o) => belongs(o, callId) && settledOp(o),
      );
      if (!operations.length) return false;
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
      if (!ok) {
        // Only a draft the document moved away from (typed into since) is
        // a conflict - that one locks every decision until it is redone. A
        // change that just doesn't fit any more fails alone.
        const stale =
          !!current.conflicted ||
          (run((ctx) => {
            const state = ctx.get(editorViewCtx).state;
            return (
              (documentRevisionKey.getState(state) ?? 0) !==
                current.baseRevision ||
              ctx.get(serializerCtx)(state.doc) !== current.baseMarkdown
            );
          }) ??
            true);
        if (stale) {
          setConflict(true);
          return false;
        }
        if (!callId) {
          // 全部采纳 as one transaction failed (two changes in each other's
          // way): take them one at a time, leaving what can't go in.
          let taken = 0;
          for (const op of operations)
            if (accept(op.callId)) taken++;
          return taken > 0;
        }
        const after = draftRef.current;
        if (after)
          update({
            ...after,
            operations: after.operations.filter((o) => !operations.includes(o)),
          });
        setStatuses((prev) => ({
          ...prev,
          ...Object.fromEntries(
            operations.map((o) => [o.callId, "invalid" as const]),
          ),
        }));
        return false;
      }
      if (ok) {
        for (const o of operations) closedIds.current.add(o.callId);
        setStatuses((prev) => ({
          ...prev,
          ...Object.fromEntries(
            operations.map((o) => [o.callId, "accepted" as const]),
          ),
        }));
      }
      return ok;
    },
    [run, update],
  );
  /** Puts rejected change (or paragraph) `callId` back in the draft, in
   *  its place among its change's parts. With nothing else pending the
   *  draft's base may predate edits made since: it starts from the document
   *  as it is. A change that was split comes back as all its parts. */
  const putBack = useCallback(
    (callId: string, proposal: EditProposal, sessionId: string) => {
      const kept = rejected.filter((o) => belongs(o, callId));
      const ops = kept.length ? kept : [{ callId, proposal }];
      const current = draftRef.current;
      let base = current;
      if (!base || !base.operations.length) {
        const next = run((ctx) =>
          captureDraft(
            ctx,
            ctx.get(editorViewCtx).state,
            documentId,
            sessionId,
          ),
        );
        if (!next) return null;
        base = { ...next, id: current?.id ?? next.id };
      }
      let operations = base.operations;
      for (const op of ops) operations = insertInOrder(operations, op);
      update({ ...base, operations });
      setRejected((prev) => prev.filter((o) => !belongs(o, callId)));
      setStatuses((prev) => {
        const next = { ...prev };
        for (const op of ops) delete next[op.callId];
        return next;
      });
      return ops;
    },
    [rejected, run, documentId, update],
  );
  /** A rejected change or paragraph back to undecided ("恢复"). */
  const undoReject = useCallback(
    (callId: string, proposal: EditProposal, sessionId: string) =>
      putBack(callId, proposal, sessionId) !== null,
    [putBack],
  );
  /** Changes the user's mind about a rejected change: puts it back and
   *  accepts it, against the document as it reads now. One that no longer
   *  fits (its passage changed since) is backed out again and marked
   *  invalid, so its card offers to relocate it. */
  const reinstate = useCallback(
    (callId: string, proposal: EditProposal, sessionId: string) => {
      const ops = putBack(callId, proposal, sessionId);
      if (!ops) return false;
      if (accept(callId)) return true;
      const after = draftRef.current;
      if (after)
        update({
          ...after,
          operations: after.operations.filter((o) => !belongs(o, callId)),
        });
      setConflict(!!after?.conflicted);
      setStatuses((prev) => ({ ...prev, [callId]: "invalid" }));
      return false;
    },
    [putBack, update, accept],
  );
  /** Splits change `callId` into one part per paragraph so each can be
   *  decided on its own; returns the parts' ids (just `callId` when there
   *  is nothing to split). The chat keeps one card for it (statusOf). */
  const explode = useCallback(
    (callId: string) => {
      const current = draftRef.current;
      const op = current?.operations.find(
        (o) => o.callId === callId && !o.parent,
      );
      if (!current || !op) return [];
      // Not while its text is still arriving: the parts would be cut from
      // half of it.
      if (!settledOp(op)) return [];
      // Only text added at the end splits (SPLITTABLE_ACTIONS).
      if (!SPLITTABLE_ACTIONS.has(op.proposal.action) || !op.proposal.text)
        return [callId];
      const parts = run((ctx) => {
        const doc = parseMarkdownSource(ctx, op.proposal.text ?? "");
        return doc ? serializeBlocks(ctx, doc).map((b) => b.markdown) : null;
      });
      if (!parts || parts.length < 2) return [callId];
      const subs: DraftOperation[] = parts.map((text, part) => ({
        callId: `${callId}::${part}`,
        parent: callId,
        part,
        parts,
        proposal: { ...op.proposal, text },
      }));
      closedIds.current.add(callId);
      update({
        ...current,
        operations: current.operations.flatMap((o) => (o === op ? subs : [o])),
      });
      return subs.map((sub) => sub.callId);
    },
    [run, update],
  );
  /** A change's status for its chat card: a split one is pending while any
   *  paragraph is, else accepted if any went in, else rejected. */
  const statusOf = useCallback(
    (callId: string): PendingStatus | undefined => {
      const ops = draft?.operations ?? [];
      if (ops.some((o) => o.callId === callId)) return "pending";
      if (statuses[callId]) return statuses[callId];
      const parts = ops.filter((o) => o.parent === callId);
      if (parts.length) return "pending";
      const decided = Object.entries(statuses).filter(([id]) =>
        id.startsWith(`${callId}::`),
      );
      if (!decided.length) return undefined;
      if (decided.some(([, s]) => s === "accepted")) return "accepted";
      if (decided.some(([, s]) => s === "invalid")) return "invalid";
      return "rejected";
    },
    [draft, statuses],
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
  /** Whether change `callId` (or its paragraph) has finished arriving. */
  const isSettled = useCallback(
    (callId: string) => {
      const op = draftRef.current?.operations.find((o) => o.callId === callId);
      return op ? settledOp(op) : !streamingIds.current.has(callId);
    },
    // settledOp reads a ref.
    [],
  );
  const finish = useCallback(
    (outcome: "stopped" | "failed" = "stopped") => {
      // Routing stays on: the exchange's final turns still arrive after
      // busy falls. Other surfaces end it themselves (endRouting), and the
      // detached window bypasses the workspace.
      stream.finish(outcome);
      // The exchange is over: nothing is still arriving.
      streamingIds.current.clear();
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
    reinstate,
    undoReject,
    isSettled,
    explode,
    statusOf,
    discard,
    rejected,
    statuses,
    finish,
    endRouting,
    restore,
    currentDraft,
    setMediaPending,
    rebaseAfterCommit,
  };
}
