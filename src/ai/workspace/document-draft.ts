import { serializerCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { EditorState, type Transaction } from "@milkdown/kit/prose/state";
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
  /** One paragraph of a change split for per-paragraph decisions
   *  (useDocumentWorkspace's explode): the change it came from, its place
   *  in it, and every part's text - how it finds its neighbours. */
  parent?: string;
  part?: number;
  parts?: string[];
}

/** Where a split change's part goes: next to a neighbouring part already
 *  in the document (after the nearest earlier one, else before the nearest
 *  later one), so parts accepted in any order keep their order. With no
 *  neighbour in yet, the change's own placement. */
function placed(
  ctx: Ctx,
  state: EditorState,
  op: DraftOperation,
): EditProposal {
  const { parts, part } = op;
  if (!op.parent || !parts || part === undefined) return op.proposal;
  const blocks = serializeBlocks(ctx, state.doc);
  const text = op.proposal.text ?? "";
  for (let j = part - 1; j >= 0; j--)
    if (findMarkdownMatch(blocks, parts[j]))
      return { ...op.proposal, action: "insert_after", anchor: parts[j], text };
  for (let j = part + 1; j < parts.length; j++)
    if (findMarkdownMatch(blocks, parts[j]))
      return {
        ...op.proposal,
        action: "insert_before",
        anchor: parts[j],
        text,
      };
  return op.proposal;
}
export interface DocumentDraft {
  id: string;
  documentId: string;
  sessionId: string;
  baseRevision: number;
  conflicted?: boolean;
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

/** Rebase captured targets through our commit, never through the UI selection. */
export function rebaseDraftAfterTransaction(
  ctx: Ctx,
  state: EditorState,
  draft: DocumentDraft,
  tr: Transaction,
): DocumentDraft {
  let { from, to } = draft.selection;
  let touched = false;
  for (const map of tr.mapping.maps) {
    map.forEach((start, end) => {
      if (
        from === to
          ? start <= from && end >= from
          : (start < to && end > from) ||
            (start === end && start > from && start < to)
      )
        touched = true;
    });
    from = map.map(from, 1);
    to = map.map(to, -1);
  }
  const remainingSelection = draft.operations.some((op) =>
    ["replace_selection", "insert_at_cursor"].includes(op.proposal.action),
  );
  return {
    ...draft,
    baseRevision: documentRevisionKey.getState(state) ?? 0,
    baseMarkdown: ctx.get(serializerCtx)(state.doc),
    selection: { from: Math.min(from, to), to: Math.max(from, to) },
    conflicted: draft.conflicted || (touched && remainingSelection),
  };
}

function resolve(
  ctx: Ctx,
  state: EditorState,
  proposal: EditProposal,
  selection: DocumentDraft["selection"],
) {
  if (proposal.action === "append") {
    // Empty paragraphs at the end (a blank document is one) are taken over
    // rather than kept: appended after them they stayed as blank lines -
    // above the title on a new document, between sections on a long run.
    const { doc } = state;
    let from = doc.content.size;
    for (let i = doc.childCount - 1; i >= 0; i--) {
      const block = doc.child(i);
      if (block.type.name !== "paragraph" || block.content.size) break;
      from -= block.nodeSize;
    }
    return { from, to: doc.content.size, text: proposal.text ?? "" };
  }
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
  const parents = new Set<string>();
  for (const op of draft.operations) {
    const { callId } = op;
    const proposal = placed(ctx, state, op);
    if (
      ids.has(callId) ||
      (proposal.action !== "delete" && typeof proposal.text !== "string")
    )
      return null;
    ids.add(callId);
    // A later part of a change whose earlier part goes in first is placed
    // beside it once that is applied, below - not against the base.
    if (op.parent) {
      if (parents.has(op.parent)) continue;
      parents.add(op.parent);
    }
    const range = resolve(ctx, state, proposal, draft.selection);
    if (!range) return null;
    // Appends stack at the end in order - each takes the blank tail only
    // when it is still there - so they never collide with each other.
    if (proposal.action === "append") continue;
    if (ranges.some((r) => range.from < r.to && r.from < range.to)) return null;
    ranges.push(range);
  }
  let next = state;
  const batch = state.tr;
  try {
    for (const op of draft.operations) {
      const mapped = {
        from: batch.mapping.map(draft.selection.from),
        to: batch.mapping.map(draft.selection.to),
      };
      const target = resolve(ctx, next, placed(ctx, next, op), mapped);
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
    draft.conflicted ||
    (documentRevisionKey.getState(state) ?? 0) !== draft.baseRevision ||
    ctx.get(serializerCtx)(state.doc) !== draft.baseMarkdown
  )
    return null;
  return transaction(ctx, state, draft);
}

/** For an explicit user action anchored to a passage (selection
 *  illustrations): resolves against the live document, so typing elsewhere
 *  while the image generates does not strand it. The anchor must still match. */
export function buildAnchoredTransaction(
  ctx: Ctx,
  state: EditorState,
  draft: DocumentDraft,
) {
  return transaction(ctx, state, {
    ...draft,
    conflicted: false,
    selection: { from: state.selection.from, to: state.selection.to },
  });
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
