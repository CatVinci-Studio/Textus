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
import {
  pairedPrefix,
  splitSentences,
  trimBreaks,
} from "./sentence-diff";
import { diffSentences, splitUnits } from "./unit-diff";
import { matchableMarkdown } from "./markdown-forms";
import { findInOrder, locateHunks } from "./sentence-locate";
import { locatePlainText } from "./text-locate";
import { wholeParagraphs } from "./whole-paragraphs";

/**
 * Where a proposal goes in the document: the blocks it names, the
 * sentences it changes found in the text, and what deciding it decided.
 * Pure - each reads the editor's state and writes nothing (usePendingEdits
 * dispatches).
 */

/**
 * What a `replace_selection` proposal targets: the selection the request was
 * sent with, in this window's coordinates. Each surface passes the selection
 * IT sent (MilkdownEditor's showProposals), the only one the model was shown;
 * Quick Ask's `InlineChatInfo` satisfies it structurally.
 */
export interface SelectionTarget {
  range: { from: number; to: number } | null;
  selectionMarkdown: string | null;
  /** The caret when the request was sent with nothing selected - where an
   *  insert_at_cursor proposal writes. */
  cursor?: number | null;
}

/**
 * A tighter strike range for `replace`/`delete`, covering just the text
 * actually being removed rather than the whole containing block - see
 * text-locate.ts for why plain-text location sidesteps the markdown-offset
 * constraint that forces `match.from`/`match.to` to the block boundary.
 * Null (falls back to the whole-block range) whenever the match spans more
 * than one block, the matched markdown fails to parse, or its plain text
 * isn't uniquely findable in the block - never a worse result than today's
 * whole-block strike, only sometimes a more precise one.
 */
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

  // The shared guarded parse (its math normalization is a no-op here -
  // `matched` came from this editor's own serializer, so math is already
  // $-delimited).
  const parsed = parseMarkdownSource(ctx, matched);
  if (!parsed || typeof parsed === "string") return null;
  const parsedText = parsed.textContent;
  if (!parsedText) return null;

  return locatePlainText(doc, match.from, match.to, parsedText);
}

/** Where a passage a comment or a picture names is in the document now -
 *  narrowed to its quoted words when they sit inside one block, else the
 *  blocks. For a comment card's "locate". */
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

/** Where a proposal named by its blocks (replace/delete/insert_before/
 *  after) lands in `doc` now, and what it would write there. Null when its
 *  blocks are gone (changed since the request). */
export function resolveAnchored(
  ctx: Ctx,
  doc: ProseNode,
  blocks: MarkdownBlock[],
  proposal: EditProposal,
): {
  range: { from: number; to: number };
  replacement: string;
  strikeRange: { from: number; to: number } | null;
  /** The markdown in `range` before the anchor (MarkdownMatch.prefix). */
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
    strikeRange:
      proposal.action === "replace" || proposal.action === "delete"
        ? computeStrikeRange(ctx, doc, blocks, match)
        : null,
    lead: match.prefix,
  };
}

/**
 * A rewrite's sentence-by-sentence view (PendingPreview.sentences): the
 * diff of what it replaces against its text, each change found in the
 * document. Null when the proposal isn't a rewrite, nothing changed, or a
 * piece can't be found - it is then shown and decided whole. `lead`: the
 * markdown in `range` before `original` (locateHunks).
 */
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

/**
 * A rewrite whose original the writer edited while it streamed in, found
 * again change by change in `range` as the text now reads: each change
 * whose original sentences are still there, in order, stands; one whose
 * original they changed is left out. Null when none is left. The changes
 * are then applied one by one (PendingPreview.rebased), never the range
 * whole - that would undo what the writer typed.
 */
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

/** A change over several original sentences: where each stands, and where
 *  its new text goes (PendingSentence.parts / .at) - the layout the same
 *  rewrite has while it streams in (pending-edit-plugin's
 *  streamDecorations). */
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

/**
 * The original of a rewrite split into sentences, each found in the
 * document: what lets the rewrite be laid out sentence by sentence while it
 * is still streaming (PendingPreview.streamSource). Undefined when a
 * sentence can't be found - it then streams in whole, as before.
 */
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

/** `markdown`'s text as the document shows it (matchableMarkdown), for
 *  finding it there. */
export function plainText(ctx: Ctx, markdown: string): string | null {
  const parsed = parseMarkdownSource(ctx, matchableMarkdown(markdown));
  return parsed && typeof parsed !== "string" ? parsed.textContent : null;
}

export const isAnchored = (proposal: EditProposal) =>
  proposal.action !== "append" &&
  proposal.action !== "insert_at_cursor" &&
  proposal.action !== "replace_selection";

/** A change the writer decided, for learning from it (revision-learning). */
export interface DecidedChange {
  before: string;
  after: string;
  taken: boolean;
}

/** What deciding `preview` decided: each of its sentences, `take(i)`, or
 *  a rewrite shown whole, `take(-1)`. New text alone (Write) has no
 *  before to compare and decides nothing to learn from. */
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

/** Whether a proposal carries pictures being made, on their own or in
 *  its text: its Accept saves them first (acceptPictures). */
export function carriesPictures(preview: PendingPreview): boolean {
  return (
    !!preview.proposal.image || hasGeneratedImage(preview.proposal.text ?? "")
  );
}

/** A proposal as showPreviews is given it. */
export interface ProposalToPlace {
  callId: string;
  proposal: EditProposal;
  /** Its arguments are still arriving: placed early so the text can grow
   *  in the document, un-acceptable until the final add for the same
   *  callId lands without the flag. */
  streaming?: boolean;
}

/**
 * Where each proposal goes in the document as it stands, as previews for
 * pending-edit-plugin, and the ones that can't go anywhere (a final
 * proposal only - a streaming draft that doesn't resolve isn't shown yet).
 * Reads the editor and writes nothing: usePendingEdits dispatches.
 */
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
      // Targets the selection captured when the chat opened. Staleness
      // is judged on the selection's MARKDOWN: that's what the model
      // was shown, so a formatting-only change under it (bolding a
      // word) has to invalidate the proposal just as a text change
      // would - the reply was written against the old formatting.
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
      // streamed in. Found again where its draft stands, change by
      // change, if any change's original is still there.
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
      // A still-streaming draft that doesn't resolve just isn't shown
      // yet - the final proposal gets the real verdict; only IT may
      // mark the call invalid.
      if (!streaming) invalidIds.push(callId);
      continue;
    }
    // Only the final proposal is split into sentences: a streaming
    // draft's text is still growing (and is typed in whole anyway).
    // An anchor across paragraphs has no strike range of its own
    // (computeStrikeRange): its sentences are found in the whole
    // blocks, past what precedes it there. Rewriting several
    // paragraphs at once - what Revise does to text Write just
    // added - used to be shown whole, and no revision view applied.
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
