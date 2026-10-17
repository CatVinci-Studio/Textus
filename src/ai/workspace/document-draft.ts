import { serializerCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { EditorState } from "@milkdown/kit/prose/state";
import { closeHistory } from "@milkdown/kit/prose/history";
import type { EditProposal } from "../types";
import {
  composeMarkdownEdit,
  findMarkdownMatch,
  serializeBlocks,
} from "../doc-markdown";
import { applyEditRange } from "../revision/apply-edit";
import { parseMarkdownSource } from "../../editor/markdown/parse-markdown-source";
import { documentRevisionKey } from "./revision-plugin";

export interface DraftOperation {
  callId: string;
  proposal: EditProposal;
}
export interface DocumentDraft {
  id: string;
  documentId: string;
  sessionId: string;
  baseRevision: number;
  baseMarkdown: string;
  selection: { from: number; to: number };
  operations: DraftOperation[];
}

export function captureDraft(
  ctx: Ctx,
  state: EditorState,
  documentId: string,
  sessionId: string,
): DocumentDraft {
  return {
    id: crypto.randomUUID(),
    documentId,
    sessionId,
    baseRevision: documentRevisionKey.getState(state) ?? 0,
    baseMarkdown: ctx.get(serializerCtx)(state.doc),
    selection: { from: state.selection.from, to: state.selection.to },
    operations: [],
  };
}

function resolve(
  ctx: Ctx,
  state: EditorState,
  proposal: EditProposal,
  selection: DocumentDraft["selection"],
) {
  if (proposal.action === "append")
    return {
      from: state.doc.content.size,
      to: state.doc.content.size,
      text: proposal.text ?? "",
    };
  if (
    proposal.action === "replace_selection" ||
    proposal.action === "insert_at_cursor"
  ) {
    const { from, to } = selection;
    if (
      from < 0 ||
      to > state.doc.content.size ||
      from > to ||
      (proposal.action === "replace_selection" && from === to)
    )
      return null;
    return {
      from,
      to: proposal.action === "insert_at_cursor" ? from : to,
      text: proposal.text ?? "",
    };
  }
  const match = findMarkdownMatch(
    serializeBlocks(ctx, state.doc),
    proposal.anchor ?? "",
    proposal.context,
  );
  return match
    ? {
        from: match.from,
        to: match.to,
        text: composeMarkdownEdit(match, proposal.action, proposal.text ?? ""),
      }
    : null;
}

function transaction(ctx: Ctx, state: EditorState, draft: DocumentDraft) {
  if (!draft.operations.length) return null;
  // Resolve all targets against the base before building any steps. Two
  // operations touching the same block require a new proposal, not a guess.
  const ranges: { from: number; to: number }[] = [];
  const ids = new Set<string>();
  for (const { callId, proposal } of draft.operations) {
    if (
      ids.has(callId) ||
      (proposal.action !== "delete" && typeof proposal.text !== "string")
    )
      return null;
    ids.add(callId);
    const range = resolve(ctx, state, proposal, draft.selection);
    if (!range || ranges.some((r) => range.from < r.to && r.from < range.to))
      return null;
    ranges.push(range);
  }
  let next = state;
  const batch = state.tr;
  try {
    for (const { proposal } of draft.operations) {
      const mapped = {
        from: batch.mapping.map(draft.selection.from),
        to: batch.mapping.map(draft.selection.to),
      };
      const target = resolve(ctx, next, proposal, mapped);
      if (!target || !parseMarkdownSource(ctx, target.text)) return null;
      const tr = applyEditRange(next, ctx, target.from, target.to, target.text);
      for (const step of tr.steps) batch.step(step);
      next = next.apply(tr);
    }
    return closeHistory(batch);
  } catch {
    return null;
  }
}

/** Validates synchronously against the live editor, never the debounced tab. */
export function buildDraftTransaction(
  ctx: Ctx,
  state: EditorState,
  draft: DocumentDraft,
) {
  if (
    (documentRevisionKey.getState(state) ?? 0) !== draft.baseRevision ||
    ctx.get(serializerCtx)(state.doc) !== draft.baseMarkdown
  )
    return null;
  return transaction(ctx, state, draft);
}

/** Uses the captured base so manual edits cannot silently change a preview. */
export function previewDraft(
  ctx: Ctx,
  state: EditorState,
  draft: DocumentDraft,
): string {
  const doc = parseMarkdownSource(ctx, draft.baseMarkdown);
  if (!doc) return draft.baseMarkdown;
  const base = EditorState.create({ schema: state.schema, doc });
  const tr = transaction(ctx, base, draft);
  return tr ? ctx.get(serializerCtx)(tr.doc) : draft.baseMarkdown;
}
