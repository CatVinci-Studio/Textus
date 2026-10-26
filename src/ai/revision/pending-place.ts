import type { Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorState } from "@milkdown/kit/prose/state";
import { visibleTextBetween } from "../../editor/markdown/link-reveal";
import { parseMarkdownSource } from "../../editor/markdown/parse-markdown-source";
import {
  composeMarkdownEdit,
  matchTarget,
  serializeBlocks,
  type BlockTarget,
  serializeRange,
  type MarkdownBlock,
  type MarkdownMatch,
} from "../doc-markdown";
import type { EditProposal } from "../types";
import { hasGeneratedImage } from "./generated-images";
import {
  pendingEditKey,
  type PendingPreview,
  type PendingSentence,
} from "./pending-edit-plugin";
import { pairedPrefix, splitSentences, trimBreaks } from "./sentence-diff";
import { diffSentences, splitUnits } from "./unit-diff";
import { matchableMarkdown } from "./markdown-forms";
import { findInOrder, locateHunks } from "./sentence-locate";
import { locatePlainText } from "./text-locate";
import { wholeParagraphs } from "./whole-paragraphs";

/** Where a proposal goes in the document and what deciding it decided.
 *  Reads the editor's state and writes nothing. */

/** What a `replace_selection` proposal targets: the selection the request
 *  was sent with, in this window's coordinates. */
export interface SelectionTarget {
  range: { from: number; to: number } | null;
  selectionMarkdown: string | null;
  /** The caret when the request was sent with nothing selected - where an
   *  insert_at_cursor proposal writes. */
  cursor?: number | null;
}

/** A strike range covering just the removed text, found by plain text since
 *  Markdown offsets only map to block boundaries. Null falls back to the
 *  whole block: across blocks, unparseable, or not unique. */
function computeStrikeRange(
  ctx: Ctx,
  doc: ProseNode,
  blocks: MarkdownBlock[],
  match: MarkdownMatch,
): { from: number; to: number } | null {
  const block = blocks.find((b) => b.from === match.from);
  if (!block || block.to !== match.to) return null; // spans more than one block

  const matched = match.markdown.slice(
    match.prefix.length,
    match.markdown.length - match.suffix.length,
  );
  if (!matched) return null;

  // `matched` came from this editor's serializer, so math is already
  // $-delimited.
  const parsed = parseMarkdownSource(ctx, matched);
  if (!parsed || typeof parsed === "string") return null;
  const parsedText = parsed.textContent;
  if (!parsedText) return null;

  return locatePlainText(doc, match.from, match.to, parsedText);
}

/** Where a passage a comment or picture names is now: its quoted words when
 *  inside one block, else the blocks. */
export function locateTarget(
  ctx: Ctx,
  doc: ProseNode,
  target: BlockTarget,
): { from: number; to: number } | null {
  const blocks = serializeBlocks(ctx, doc);
  const match = matchTarget(blocks, target);
  if (!match) return null;
  return (
    computeStrikeRange(ctx, doc, blocks, match) ?? {
      from: match.from,
      to: match.to,
    }
  );
}

/** Where a block-anchored proposal lands in `doc` now and what it would
 *  write; null when its blocks have changed since the request. */
export function resolveAnchored(
  ctx: Ctx,
  doc: ProseNode,
  blocks: MarkdownBlock[],
  proposal: EditProposal,
): {
  range: { from: number; to: number };
  replacement: string;
  strikeRange: { from: number; to: number } | null;
  /** The markdown in `range` before the anchor. */
  lead: string;
} | null {
  const match = matchTarget(blocks, proposal);
  if (!match) return null;
  return {
    range: { from: match.from, to: match.to },
    replacement: composeMarkdownEdit(
      match,
      proposal.action,
      proposal.text ?? "",
    ),
    // An insertion next to words inside its block is drawn there, where
    // Accept writes it; one next to the whole block goes beside it.
    strikeRange:
      proposal.action === "replace" ||
      proposal.action === "delete" ||
      ((proposal.action === "insert_before" ||
        proposal.action === "insert_after") &&
        (match.prefix.trim() !== "" || match.suffix.trim() !== ""))
        ? computeStrikeRange(ctx, doc, blocks, match)
        : null,
    lead: match.prefix,
  };
}

/** A rewrite's sentence-by-sentence view, each change found in the
 *  document. Null shows it whole. `lead`: the markdown before `original`. */
function sentencesFor(
  ctx: Ctx,
  doc: ProseNode,
  proposal: EditProposal,
  original: string | null,
  range: { from: number; to: number } | null,
  lead = "",
): PendingPreview["sentences"] {
  if (original === null || !range || proposal.text === undefined)
    return undefined;
  const hunks = diffSentences(original, proposal.text);
  if (!hunks.some((h) => h.kind === "change")) return undefined;
  const ranges = locateHunks(
    doc,
    range.from,
    range.to,
    hunks,
    (markdown) => plainText(ctx, markdown),
    lead,
  );
  if (!ranges) return undefined;
  const changes = hunks.flatMap((h, i) =>
    h.kind === "change"
      ? [
          {
            ...ranges[i],
            before: h.before,
            after: h.after,
            take: null,
            expected: visibleTextBetween(
              doc,
              ranges[i].from,
              ranges[i].to,
              " ",
            ),
            ...(ranges[i].block
              ? { block: true, at: ranges[i].to }
              : (wholeParagraphs(doc, ranges[i], h.before, h.after) ??
                changeParts(ctx, doc, ranges[i], h.before, h.after))),
          },
        ]
      : [],
  );
  return { hunks, changes };
}

/** A rewrite whose original the writer edited while it streamed, found again
 *  change by change; null when none is left. Applied change by change, as
 *  the whole range would undo what they typed. */
function rebasedSentences(
  ctx: Ctx,
  doc: ProseNode,
  original: string,
  text: string,
  range: { from: number; to: number },
): PendingPreview["sentences"] {
  const hunks = diffSentences(original, text);
  const changes: PendingSentence[] = [];
  let cursor = range.from;
  for (const h of hunks) {
    if (h.kind !== "change" || !h.before.trim()) continue;
    const plain =
      plainText(ctx, trimBreaks(h.before))?.replace(/\n/g, "").trim() ?? "";
    const [found] = plain ? findInOrder(doc, cursor, range.to, [plain]) : [];
    if (!found) continue;
    cursor = found.to;
    changes.push({
      ...found,
      before: h.before,
      after: h.after,
      take: null,
      expected: visibleTextBetween(doc, found.from, found.to, " "),
    });
  }
  return changes.length > 0 ? { hunks, changes } : undefined;
}

/** A change over several original sentences: where each stands and where
 *  its new text goes, as while it streamed in. */
function changeParts(
  ctx: Ctx,
  doc: ProseNode,
  range: { from: number; to: number },
  before: string,
  after: string,
): { parts?: { from: number; to: number }[]; at?: number } {
  const sentences = splitSentences(before);
  if (sentences.length < 2) return {};
  const parts = findInOrder(
    doc,
    range.from,
    range.to,
    sentences.map(
      (s) => plainText(ctx, trimBreaks(s))?.replace(/\n/g, "").trim() ?? "",
    ),
  );
  if (parts.length !== sentences.length) return {};
  return { parts, at: parts[pairedPrefix(sentences, after) - 1].to };
}

/** A rewrite's original split into sentences found in the document, for
 *  laying it out while it streams. Undefined streams it in whole. */
function streamSourceFor(
  ctx: Ctx,
  doc: ProseNode,
  original: string | null,
  range: { from: number; to: number } | null,
  lead = "",
): PendingPreview["streamSource"] {
  if (original === null || !range) return undefined;
  const sentences = splitUnits(original);
  if (sentences.length === 0) return undefined;
  const ranges = locateHunks(
    doc,
    range.from,
    range.to,
    sentences.map((text) => ({ kind: "same", text })),
    (markdown) => plainText(ctx, markdown),
    lead,
  );
  return ranges ? { sentences, ranges } : undefined;
}

/** `markdown`'s text as the document shows it, for finding it there. */
export function plainText(ctx: Ctx, markdown: string): string | null {
  const parsed = parseMarkdownSource(ctx, matchableMarkdown(markdown));
  return parsed && typeof parsed !== "string" ? parsed.textContent : null;
}

export const isAnchored = (proposal: EditProposal) =>
  proposal.action !== "append" &&
  proposal.action !== "insert_at_cursor" &&
  proposal.action !== "replace_selection";

/** A change the writer decided, for learning from it. */
export interface DecidedChange {
  before: string;
  after: string;
  taken: boolean;
}

/** What deciding `preview` decided, per sentence or whole (`take(-1)`). New
 *  text alone decides nothing to learn from. */
export function decidedChanges(
  preview: PendingPreview,
  take: (index: number) => boolean,
): DecidedChange[] {
  if (preview.streaming) return [];
  if (preview.sentences)
    return preview.sentences.changes.map((c, i) => ({
      before: c.before,
      after: c.after,
      taken: take(i),
    }));
  const { action, anchor, text } = preview.proposal;
  if (text === undefined) return [];
  if (action === "replace" && anchor)
    return [{ before: anchor, after: text, taken: take(-1) }];
  if (action === "replace_selection")
    return [{ before: preview.expectedText, after: text, taken: take(-1) }];
  return [];
}

/** Whether a proposal carries pictures being made: its Accept saves them
 *  first. */
export function carriesPictures(preview: PendingPreview): boolean {
  return (
    !!preview.proposal.image || hasGeneratedImage(preview.proposal.text ?? "")
  );
}

/** A proposal as showPreviews is given it. */
export interface ProposalToPlace {
  callId: string;
  proposal: EditProposal;
  /** Its arguments are still arriving: placed early so the text can grow,
   *  undecidable until the final add. */
  streaming?: boolean;
}

/** Each proposal placed as a preview, and the final ones that can't go
 *  anywhere. Writes nothing. */
export function placeProposals(
  ctx: Ctx,
  state: EditorState,
  proposals: ProposalToPlace[],
  chatInfo: SelectionTarget | null,
): { placed: PendingPreview[]; invalidIds: string[] } {
  const docSize = state.doc.content.size;
  // One serialization per batch, shared by every proposal in it.
  const blocks = serializeBlocks(ctx, state.doc);
  const placed: PendingPreview[] = [];
  const invalidIds: string[] = [];

  for (const { callId, proposal, streaming } of proposals) {
    let range: { from: number; to: number } | null = null;
    let replacement = proposal.text ?? "";
    let strikeRange: { from: number; to: number } | null = null;
    let lead = "";

    if (proposal.action === "append") {
      range = { from: docSize, to: docSize };
    } else if (proposal.action === "insert_at_cursor") {
      const at = chatInfo?.cursor;
      if (typeof at === "number" && at <= docSize) range = { from: at, to: at };
    } else if (proposal.action === "replace_selection") {
      // Staleness is judged on the selection's Markdown, as the model saw
      // it, so a formatting-only change invalidates it too.
      if (
        chatInfo?.range &&
        chatInfo.range.to <= docSize &&
        serializeRange(
          ctx,
          state.doc,
          chatInfo.range.from,
          chatInfo.range.to,
        ) === (chatInfo.selectionMarkdown ?? "")
      ) {
        range = chatInfo.range;
      }
    } else {
      const resolved = resolveAnchored(ctx, state.doc, blocks, proposal);
      if (resolved) ({ range, replacement, strikeRange, lead } = resolved);
      // Not found as quoted: the writer edited its original while it
      // streamed. Found again change by change where its draft stands.
      const draft = !resolved
        ? pendingEditKey
            .getState(state)
            ?.previews.find((p) => p.callId === callId && p.rebased)
        : undefined;
      const sentences =
        draft && !streaming && proposal.action === "replace"
          ? rebasedSentences(
              ctx,
              state.doc,
              proposal.anchor ?? "",
              proposal.text ?? "",
              draft,
            )
          : undefined;
      if (draft && sentences) {
        placed.push({
          ...draft,
          proposal,
          expectedText: visibleTextBetween(
            state.doc,
            draft.from,
            draft.to,
            " ",
          ),
          streaming: undefined,
          sentences,
          rebased: true,
          streamSource: undefined,
        });
        continue;
      }
    }

    if (!range) {
      // A streaming draft that doesn't resolve isn't shown yet; only the
      // final proposal may mark the call invalid.
      if (!streaming) invalidIds.push(callId);
      continue;
    }
    // Only the final proposal is split into sentences. An anchor across
    // paragraphs has no strike range: its sentences are found in the whole
    // blocks, past what precedes it there.
    const sentences = streaming
      ? undefined
      : proposal.action === "replace"
        ? sentencesFor(
            ctx,
            state.doc,
            proposal,
            proposal.anchor ?? null,
            strikeRange ?? range,
            strikeRange ? "" : lead,
          )
        : proposal.action === "replace_selection"
          ? sentencesFor(
              ctx,
              state.doc,
              proposal,
              chatInfo?.selectionMarkdown ?? null,
              range,
            )
          : undefined;
    // Also on the final add: it lands while the text is still typing
    // in, and the layout must not fall back to one block then.
    const streamSource =
      proposal.action === "replace"
        ? streamSourceFor(
            ctx,
            state.doc,
            proposal.anchor ?? null,
            strikeRange ?? range,
            strikeRange ? "" : lead,
          )
        : proposal.action === "replace_selection"
          ? streamSourceFor(
              ctx,
              state.doc,
              chatInfo?.selectionMarkdown ?? null,
              range,
            )
          : undefined;
    placed.push({
      callId,
      proposal,
      from: range.from,
      to: range.to,
      expectedText: visibleTextBetween(state.doc, range.from, range.to, " "),
      replacement,
      streaming,
      strikeFrom: strikeRange?.from,
      strikeTo: strikeRange?.to,
      sentences,
      streamSource,
    });
  }

  return { placed, invalidIds };
}
