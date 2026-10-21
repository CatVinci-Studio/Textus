import { closeHistory } from "@milkdown/kit/prose/history";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import { visibleTextBetween } from "../../editor/markdown/link-reveal";
import { parseMarkdownSource } from "../../editor/markdown/parse-markdown-source";
import {
  composeMarkdownEdit,
  documentMarkdown,
  findMarkdownMatch,
  serializeBlocks,
  serializeRange,
  type MarkdownBlock,
  type MarkdownMatch,
} from "../doc-markdown";
import { applyEditRange } from "./apply-edit";
import { useLatest } from "../../utils/hooks/useLatest";
import {
  citationsAsFootnotes,
  footnoteLabels,
  hasCitations,
  withoutCitations,
} from "../citations";
import type { WebSource } from "../types";
import { isIOSApp } from "../../platform/capabilities";
import {
  pendingEditKey,
  reviewChanges,
  sentenceTake,
  type PendingPreview,
} from "./pending-edit-plugin";
import {
  composeSentences,
  diffSentences,
  pairedPrefix,
  splitSentences,
  trimBreaks,
} from "./sentence-diff";
import { findInOrder, locateHunks } from "./sentence-locate";
import { nextFocusAfterChange, orderForReview } from "./pending-edit-focus";
import { locatePlainText } from "./text-locate";
import type { EditProposal } from "../types";
import {
  discardGeneratedImage,
  generatedAlt,
  generatedIdsIn,
  generatedImageData,
  generatedImageFailure,
  hasGeneratedImage,
  joinedText,
  pictureSrc,
  pictureState,
  loadGeneratedImage,
  rememberSaved,
  savedSrc,
  withSavedSrc,
  withoutPicture,
} from "./generated-images";
import type { GeneratedImageData } from "../../platform/ipc";
import { usePicturesState } from "./usePicturesState";
import type { EditorRunner } from "../../editor/useEditorRunner";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";

/** `streaming`: the proposal exists but can't be decided yet - its
 *  arguments are still arriving or its text is still typing into the
 *  document (pending-edit-plugin settles it when the reveal completes). */
export type PendingStatus =
  | "pending"
  | "streaming"
  | "accepted"
  | "rejected"
  | "invalid"
  | "expired"
  // A picture put into the text proposal it goes with (joinPicture),
  // decided with it.
  | "joined";

/**
 * What a `replace_selection` proposal targets: the selection the request was
 * sent with, in this window's coordinates.
 *
 * Narrower than the whole `InlineChatInfo` on purpose, because there are now
 * two things that can supply it and only one of them is Quick Ask. The
 * detached window is the cross-file surface, so it can be asked to rewrite a
 * selection in a tab that never opened the in-document bar at all - and then
 * there is no chatInfo to resolve against. Each surface passes the selection
 * IT sent (MilkdownEditor's showProposals), which is also the only one the
 * model was actually shown. `InlineChatInfo` satisfies this structurally, so
 * the Quick Ask path is unchanged.
 */
/** What accepting a proposal does with its web citations (citations.ts). */
export interface CitationStyle {
  /** Settings' sourcesAsFootnotes, set from the proposal card. */
  asFootnotes: boolean;
  /** The conversation's sources, which title the footnotes. */
  sources: WebSource[];
}

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

/** Where an agent's quoted passage is in the document now - narrowed to the
 *  quoted text when it sits inside one block, else the touched blocks. For
 *  a comment card's "locate". */
export function locateAnchor(
  ctx: Ctx,
  doc: ProseNode,
  anchor: string,
  context?: string,
): { from: number; to: number } | null {
  const blocks = serializeBlocks(ctx, doc);
  const match = findMarkdownMatch(blocks, anchor, context);
  if (!match) return null;
  return (
    computeStrikeRange(ctx, doc, blocks, match) ?? {
      from: match.from,
      to: match.to,
    }
  );
}

/** Where an anchored proposal (replace/delete/insert_before/after) lands
 *  in `doc` now, and what it would write there. Null when its anchor no
 *  longer resolves. */
function resolveAnchored(
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
  const match = findMarkdownMatch(
    blocks,
    proposal.anchor ?? "",
    proposal.context,
  );
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
            ...changeParts(ctx, doc, ranges[i], h.before, h.after),
          },
        ]
      : [],
  );
  return { hunks, changes };
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
  const sentences = splitSentences(original);
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

function plainText(ctx: Ctx, markdown: string): string | null {
  const parsed = parseMarkdownSource(ctx, markdown);
  return parsed && typeof parsed !== "string" ? parsed.textContent : null;
}

/** One stop of the review bar: a changed sentence, or a whole proposal
 *  that isn't shown sentence by sentence (`index` -1). */
export interface ReviewStop {
  callId: string;
  index: number;
  from: number;
}

const isAnchored = (proposal: EditProposal) =>
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
function decidedChanges(
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

/**
 * Resolves propose_edit proposals to live document ranges and shows them as
 * in-document decorations (pending-edit-plugin.ts). Accept/reject lives in
 * the chat's proposal card (ChatMessages.tsx) and calls in here - the
 * decorations are display only, so there is exactly one set of controls for
 * one action. Owned by MilkdownEditor, same lifetime as the editor, so
 * previews survive the chat popup closing and reopening.
 *
 * Anchors resolve in MARKDOWN SOURCE (doc-markdown.ts), matching what the
 * model was shown. This is the only path that writes a reply into the
 * document; there is deliberately no direct-apply fallback that skips the
 * preview. The full proposal lifecycle - streaming, stop/failure endings,
 * what a consecutive prompt supersedes - is laid out in docs/design/ai-proposals.md.
 */
/** Whether a proposal carries pictures being made, on their own or in
 *  its text: its Accept saves them first (acceptPictures). */
function carriesPictures(preview: PendingPreview): boolean {
  return (
    !!preview.proposal.image || hasGeneratedImage(preview.proposal.text ?? "")
  );
}

export interface PendingEditOptions {
  /** The writer accepted or rejected a proposal (not one superseded,
   *  refused or stopped): what it decided, change by change - in place of
   *  what it decided about it before. No changes: an undo brought an
   *  accepted proposal back, undecided again. */
  onDecided?: (callId: string, changes: DecidedChange[]) => void;
  /** Saves an accepted picture the way Settings › Images says and returns
   *  the src to write - null when the user cancelled (naming it). Throws
   *  when it can't be saved. */
  storeImage?: (
    image: GeneratedImageData,
    alt: string,
  ) => Promise<string | null>;
  /** Tells the user an accepted picture couldn't be saved. */
  onImageError?: (err: unknown) => void;
  /** An accepted picture replaced one already in the document (a redone
   *  picture, generate_image's `replace`): the old one's src, for the
   *  owner to offer moving its file to the Trash. */
  onPictureReplaced?: (oldSrc: string) => void;
  /** How an accepted proposal's web citations are written, asked when it
   *  is accepted. Left out: they are left out. */
  citationStyle?: () => CitationStyle;
  /** What a decision did, said to a screen reader (useEditorProposals):
   *  how many changes the writer accepted or rejected, wherever it was
   *  decided - the review bar, a ✓ / ✕, a card, Ctrl/⌘ + Enter. */
  onAnnounce?: (kind: "accepted" | "rejected", count: number) => void;
}

export function usePendingEdits(
  run: EditorRunner,
  options: PendingEditOptions = {},
) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [previews, setPreviews] = useState<PendingPreview[]>([]);
  // Accepted proposals whose decision was reported: an undo can bring
  // them back (syncFromPlugin), and then that decision no longer stands.
  const reportedAccepts = useRef(new Set<string>());
  const decided = useCallback(
    (preview: PendingPreview, take: (i: number) => boolean) => {
      const changes = decidedChanges(preview, take);
      if (changes.length === 0) return;
      if (changes.some((c) => c.taken))
        reportedAccepts.current.add(preview.callId);
      optionsRef.current.onDecided?.(preview.callId, changes);
    },
    [],
  );
  // callId -> terminal status, kept even after the preview leaves `previews`
  // (accept/reject/an invalidating edit all remove it) so a chat card can
  // still show "Applied"/"Rejected"/"Couldn't locate" instead of reverting
  // to a plain, misleading "Pending".
  const [statuses, setStatuses] = useState<Record<string, PendingStatus>>({});
  const knownIds = useRef<Set<string>>(new Set());

  // "Review one at a time" state for Quick Ask (MilkdownEditor's nav bar) -
  // ordered by document position, not arrival order, so Next reads top to
  // bottom the way scrolling through the document would.
  const [focusedCallId, setFocusedCallId] = useState<string | null>(null);
  const decidable = useMemo(() => orderForReview(previews), [previews]);
  const focusIndex = focusedCallId
    ? decidable.findIndex((p) => p.callId === focusedCallId)
    : -1;
  const focusedPreview = focusIndex >= 0 ? decidable[focusIndex] : null;

  // Re-points the focus whenever the navigable set changes (a preview
  // settled into it, or left it via accept/reject/invalidation) - keeping
  // the pointer's POSITION (see nextFocusAfterChange) rather than resetting
  // to the start every time.
  const lastOrderRef = useRef<string[]>([]);
  useEffect(() => {
    const newOrder = decidable.map((p) => p.callId);
    setFocusedCallId((prev) =>
      nextFocusAfterChange(lastOrderRef.current, prev, newOrder),
    );
    lastOrderRef.current = newOrder;
  }, [decidable]);

  // What the review bar and the margin go through: the decidable
  // previews, and the rewrites still streaming in sentence by sentence,
  // whose completed changes are counted and shown as each one comes
  // (PendingPreview.streamChanges) - they can be looked at, not decided
  // yet.
  const reviewed = useMemo(
    () =>
      previews
        .filter((p) => !p.streaming || p.streamChanges)
        .sort((a, b) => a.from - b.from),
    [previews],
  );
  const reviewStreaming = reviewed.some((p) => p.streaming);
  // A picture still being made in a pending proposal: Accept waits for it.
  const picturesPainting =
    usePicturesState(previews.map((p) => p.proposal.text ?? "").join("\n")) ===
    "painting";

  // The review bar walks sentence by sentence: every changed sentence of a
  // proposal shown that way, or the proposal itself otherwise, top to
  // bottom. The pointer is kept by identity, falling back to the stop now
  // at its old place when its own went (decided, applied).
  const reviewStops = useMemo<ReviewStop[]>(
    () =>
      reviewed
        .flatMap((p) => {
          const changes = reviewChanges(p);
          return changes
            ? changes.map((c, index) => ({
                callId: p.callId,
                index,
                from: c.from,
              }))
            : [{ callId: p.callId, index: -1, from: p.from }];
        })
        .sort((a, b) => a.from - b.from),
    [reviewed],
  );
  const [stopKey, setStopKey] = useState<string | null>(null);
  const stopIndex = stopKey
    ? reviewStops.findIndex((s) => `${s.callId}:${s.index}` === stopKey)
    : -1;
  const focusedStop = stopIndex >= 0 ? reviewStops[stopIndex] : null;
  const lastStopsRef = useRef<string[]>([]);
  useEffect(() => {
    const keys = reviewStops.map((s) => `${s.callId}:${s.index}`);
    setStopKey((prev) => {
      if (prev === null) return null;
      return nextFocusAfterChange(lastStopsRef.current, prev, keys);
    });
    lastStopsRef.current = keys;
  }, [reviewStops]);

  /** Moves the review bar's pointer and returns where it now is. */
  const stepReview = useCallback(
    (delta: 1 | -1): ReviewStop | null => {
      if (reviewStops.length === 0) return null;
      const next =
        stopIndex === -1
          ? delta === 1
            ? 0
            : reviewStops.length - 1
          : (stopIndex + delta + reviewStops.length) % reviewStops.length;
      const stop = reviewStops[next];
      setStopKey(`${stop.callId}:${stop.index}`);
      setFocusedCallId(stop.callId);
      return stop;
    },
    [reviewStops, stopIndex],
  );

  /** Points the review bar at a sentence (index -1: the proposal's first
   *  stop) - a card's sentence or "Show in text" was clicked. */
  const pointReview = useCallback(
    (callId: string, index: number): ReviewStop | null => {
      const stop =
        reviewStops.find(
          (s) => s.callId === callId && (index < 0 || s.index === index),
        ) ?? null;
      if (stop) {
        setStopKey(`${stop.callId}:${stop.index}`);
        setFocusedCallId(stop.callId);
      }
      return stop;
    },
    [reviewStops],
  );

  /** How much an Accept-everything would take: changed sentences (a whole
   *  proposal counting as one) taken of all of them. */
  const reviewCount = useMemo(() => {
    let taken = 0;
    let total = 0;
    for (const p of reviewed) {
      const take = p.streaming
        ? (p.streamChanges ?? []).map(() => true)
        : sentenceTake(p);
      if (take) {
        total += take.length;
        taken += take.filter(Boolean).length;
      } else {
        total += 1;
        taken += 1;
      }
    }
    return { taken, total };
  }, [reviewed]);
  // For rejectAll, which stays stable (see there).
  const reviewTotalRef = useLatest(reviewCount.total);

  /** Wired (via a ref-indirected callback, see MilkdownEditor) to the
   *  plugin's onPreviewsChange - the only path React learns about a preview
   *  the plugin silently dropped because the document changed under it. */
  const syncFromPlugin = useCallback(
    (next: PendingPreview[], applied: string[] = []) => {
      const nextIds = new Set(next.map((p) => p.callId));
      const dropped = [...knownIds.current].filter((id) => !nextIds.has(id));
      knownIds.current = nextIds;
      setPreviews(next);
      for (const id of nextIds)
        if (reportedAccepts.current.delete(id))
          optionsRef.current.onDecided?.(id, []);
      setStatuses((prev) => {
        let copy: Record<string, PendingStatus> | null = null;
        const set = (id: string, status: PendingStatus | null) => {
          copy ??= { ...prev };
          if (status) copy[id] = status;
          else delete copy[id];
        };
        for (const id of dropped)
          if (!prev[id]) set(id, applied.includes(id) ? "accepted" : "invalid");
        // An undo put an accepted proposal back on offer, a redo applied
        // it again: its card follows (pending-edit-plugin's `applied`).
        for (const id of nextIds) if (prev[id] === "accepted") set(id, null);
        for (const id of applied)
          if (prev[id] !== "accepted" && !nextIds.has(id)) set(id, "accepted");
        return copy ?? prev;
      });
    },
    [],
  );

  const showPreviews = useCallback(
    (
      // `streaming` marks a proposal whose arguments are still arriving -
      // placed early so the text can grow in the document, un-acceptable
      // until the final add for the same callId lands without the flag.
      proposals: {
        callId: string;
        proposal: EditProposal;
        streaming?: boolean;
      }[],
      chatInfo: SelectionTarget | null,
    ) => {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const docSize = state.doc.content.size;
        // One serialization per batch, shared by every proposal in it.
        const blocks = serializeBlocks(ctx, state.doc);
        const resolved: PendingPreview[] = [];
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
            if (typeof at === "number" && at <= docSize)
              range = { from: at, to: at };
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
            if (resolved)
              ({ range, replacement, strikeRange, lead } = resolved);
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
          resolved.push({
            callId,
            proposal,
            from: range.from,
            to: range.to,
            expectedText: visibleTextBetween(
              state.doc,
              range.from,
              range.to,
              " ",
            ),
            replacement,
            streaming,
            strikeFrom: strikeRange?.from,
            strikeTo: strikeRange?.to,
            sentences,
            streamSource,
          });
        }

        if (resolved.length > 0) {
          view.dispatch(
            state.tr.setMeta(pendingEditKey, {
              type: "add",
              previews: resolved,
            }),
          );
        }
        if (invalidIds.length > 0) {
          setStatuses((prev) => {
            const copy = { ...prev };
            for (const id of invalidIds) copy[id] = "invalid";
            return copy;
          });
        }
      });
    },
    [run],
  );

  // Accepted pictures being saved, by call id: a second Accept while the
  // first is still saving must not save a second copy.
  const savingImages = useRef(new Set<string>());
  const acceptRef = useRef<(callId: string, text?: string) => boolean>(
    () => false,
  );

  /** The Accept of a proposal that carries pictures - a picture on its
   *  own, or text with pictures in it (generate_image's `in_text`): each
   *  saved first (Settings › Images), then the text written with their
   *  srcs like any insertion. Not while one is still being made - Accept
   *  waits for it (the card says so) - and a picture that wasn't made is
   *  left out of the text it came with; a picture on its own that wasn't
   *  made has nothing to accept. Saved once: an undo that brings the
   *  proposal back, accepted again, writes the same files. */
  const acceptPictures = useCallback(
    (callId: string, proposal: EditProposal): boolean => {
      let text = proposal.text ?? "";
      const ids = generatedIdsIn(text);
      if (ids.some((id) => pictureState(id) === "painting")) {
        for (const id of ids) void loadGeneratedImage(id);
        return false;
      }
      for (const id of ids)
        if (pictureState(id) === "failed") text = withoutPicture(text, id);
      if (!text.trim()) return false;
      const { storeImage, onImageError } = optionsRef.current;
      const unsaved = generatedIdsIn(text).filter((id) => !savedSrc(id));
      const write = (final: string) => {
        const written = acceptRef.current(callId, final);
        const old =
          written && proposal.image && proposal.action === "replace"
            ? pictureSrc(proposal.anchor ?? "")
            : null;
        if (old) optionsRef.current.onPictureReplaced?.(old);
        return written;
      };
      const withSaved = (markdown: string) =>
        generatedIdsIn(markdown).reduce(
          (t, id) => withSavedSrc(t, id, savedSrc(id)!),
          markdown,
        );
      if (unsaved.length === 0) return write(withSaved(text));
      if (!storeImage || savingImages.current.has(callId)) return false;
      savingImages.current.add(callId);
      void (async () => {
        try {
          for (const id of unsaved) {
            const data = generatedImageData(id);
            if (!data)
              throw new Error(
                generatedImageFailure(id) ??
                  "the picture is no longer available",
              );
            const stored = await storeImage(data, generatedAlt(text, id));
            // Cancelled (naming it): nothing is written.
            if (stored === null) return;
            rememberSaved(id, stored);
          }
          write(withSaved(text));
        } catch (err) {
          onImageError?.(err);
        } finally {
          savingImages.current.delete(callId);
        }
      })();
      return true;
    },
    [],
  );

  // Applies without announcing: the callers below say what was decided -
  // a sentence's ✓ that completes its proposal was the one decision, an
  // Accept of everything one decision of many changes.
  const applyAccept = useCallback(
    (
      callId: string,
      /** Partial acceptance: the proposal's text with only some of its
       *  sentence changes kept (the card's per-sentence picker). Composed
       *  against the same target the preview resolved. */
      textOverride?: string,
    ): boolean => {
      if (textOverride === undefined) {
        let pictures: EditProposal | null = null;
        run((ctx) => {
          const view = ctx.get(editorViewCtx);
          const preview = pendingEditKey
            .getState(view.state)
            ?.previews.find((p) => p.callId === callId);
          if (preview && !preview.streaming && carriesPictures(preview))
            pictures = preview.proposal;
        });
        if ((pictures as EditProposal | null)?.slot) return false;
        if (pictures) return acceptPictures(callId, pictures);
      }
      let ok = false;
      let stillStreaming = false;
      let rejectedAll = false;
      // A text of the caller's own says nothing about which changes it took.
      const learn = textOverride === undefined;
      const settled: { preview?: PendingPreview } = {};
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const before = pendingEditKey.getState(state)?.previews ?? [];
        const preview = before.find((p) => p.callId === callId);
        if (!preview) return;
        // The arguments are still streaming in: `replacement` is incomplete,
        // so applying now would write a half-generated edit. Not a failure -
        // the status stays pending and the button works once the final add
        // (same callId, no flag) lands moments later.
        if (preview.streaming) {
          stillStreaming = true;
          return;
        }
        // Defensive re-check mirroring the plugin's own staleness rule -
        // not expected to fire (the plugin already drops previews whose
        // mapped text changed), but a silent no-op here would be worse.
        if (
          visibleTextBetween(state.doc, preview.from, preview.to, " ") !==
          preview.expectedText
        )
          return;

        settled.preview = preview;
        let replacement = preview.replacement;
        // Decided sentence by sentence (the ✓ / ✕ in the text or the
        // card): Accept writes the original with only the taken changes.
        const take = sentenceTake(preview);
        if (textOverride === undefined && preview.sentences && take) {
          if (!take.some(Boolean)) {
            // Every sentence kept: nothing to write - it is a rejection.
            view.dispatch(
              state.tr.setMeta(pendingEditKey, { type: "remove", callId }),
            );
            rejectedAll = true;
            return;
          }
          if (!take.every(Boolean))
            textOverride = composeSentences(preview.sentences.hunks, take);
        }
        if (textOverride !== undefined) {
          const { proposal } = preview;
          if (
            proposal.action === "replace_selection" ||
            proposal.action === "append" ||
            proposal.action === "insert_at_cursor"
          ) {
            replacement = textOverride;
          } else {
            const match = findMarkdownMatch(
              serializeBlocks(ctx, state.doc),
              proposal.anchor ?? "",
              proposal.context,
            );
            if (!match) return;
            replacement = composeMarkdownEdit(
              match,
              proposal.action,
              textOverride,
            );
          }
        }
        // Web citations ([2](url)): footnotes at the end of the document,
        // or left out - the proposal card's "Add sources as footnotes".
        let footnotes: string[] = [];
        if (hasCitations(replacement)) {
          const cite = optionsRef.current.citationStyle?.();
          if (cite?.asFootnotes) {
            ({ text: replacement, definitions: footnotes } =
              citationsAsFootnotes(
                replacement,
                cite.sources,
                footnoteLabels(
                  documentMarkdown(serializeBlocks(ctx, state.doc)),
                ),
              ));
          } else {
            replacement = withoutCitations(replacement);
          }
        }
        const tr = applyEditRange(
          state,
          ctx,
          preview.from,
          preview.to,
          replacement,
          footnotes,
        );
        // Same transaction: one undo step restores the document exactly,
        // and the decoration is gone the instant the edit lands (no orphan
        // frame where a stale preview paints over the just-applied text).
        // Where the new text now stands - the taken sentences only, for one
        // decided by sentence - so its green can fade out there rather than
        // vanish (the plugin's `landed`).
        const written =
          preview.sentences && take
            ? preview.sentences.changes.filter((_, i) => take[i])
            : [{ after: textOverride ?? preview.proposal.text ?? "" }];
        const landed = findInOrder(
          tr.doc,
          tr.mapping.map(preview.from, -1),
          tr.mapping.map(preview.to, 1),
          written.map(
            ({ after }) =>
              plainText(ctx, trimBreaks(withoutCitations(after)))
                ?.replace(/\n/g, "")
                .trim() ?? "",
          ),
        );
        tr.setMeta(pendingEditKey, {
          type: "remove",
          callId,
          applied: true,
          landed,
        });
        // Its own undo step, never merged with typing just before it: an
        // undo then lands exactly on the text it replaced, which is what
        // brings the proposal back (pending-edit-plugin's `applied`).
        closeHistory(tr);
        view.dispatch(tr.scrollIntoView());
        // A second proposal in the same paragraph resolved to the same whole
        // block, so this edit changed the text it was waiting on and the
        // plugin let it go ("Couldn't locate that text") although its own
        // words are still there. Find those again in the new text.
        const after = pendingEditKey.getState(view.state)?.previews ?? [];
        const lost = before.filter(
          (p) =>
            p.callId !== callId &&
            !p.streaming &&
            isAnchored(p.proposal) &&
            !after.some((a) => a.callId === p.callId),
        );
        if (lost.length > 0) {
          const doc = view.state.doc;
          const blocks = serializeBlocks(ctx, doc);
          const found: PendingPreview[] = [];
          for (const p of lost) {
            const resolved = resolveAnchored(ctx, doc, blocks, p.proposal);
            if (!resolved) continue;
            const { range, replacement: text, strikeRange } = resolved;
            found.push({
              ...p,
              from: range.from,
              to: range.to,
              expectedText: visibleTextBetween(doc, range.from, range.to, " "),
              replacement: text,
              strikeFrom: strikeRange?.from,
              strikeTo: strikeRange?.to,
              // Settled already: nothing streams in again.
              streamSource: undefined,
            });
          }
          if (found.length > 0)
            view.dispatch(
              view.state.tr.setMeta(pendingEditKey, {
                type: "add",
                previews: found,
              }),
            );
        }
        // On a phone, focusing the document raises the keyboard over the
        // AI sheet the Accept was tapped in, and what the user types next
        // lands in the document instead of the composer.
        if (!isIOSApp) view.focus();
        ok = true;
      });
      if (stillStreaming) return false;
      if (rejectedAll) {
        if (settled.preview) decided(settled.preview, () => false);
        setStatuses((prev) => ({ ...prev, [callId]: "rejected" }));
        return true;
      }
      if (ok && learn && settled.preview) {
        const take = sentenceTake(settled.preview);
        decided(settled.preview, (i) => (i < 0 || !take ? true : take[i]));
      }
      setStatuses((prev) => ({
        ...prev,
        [callId]: ok ? "accepted" : "invalid",
      }));
      return ok;
    },
    [run, decided, acceptPictures],
  );
  acceptRef.current = applyAccept;

  const accept = useCallback(
    (callId: string, textOverride?: string): boolean => {
      const ok = applyAccept(callId, textOverride);
      if (ok) optionsRef.current.onAnnounce?.("accepted", 1);
      return ok;
    },
    [applyAccept],
  );

  /** Takes a proposal off the document as rejected. `learn`: the writer
   *  rejected it (Reject, ✕) - not a new request superseding it, the
   *  backend refusing it or a stop leaving nothing of it, which `discard`
   *  is for. */
  const remove = useCallback(
    (callId: string, learn: boolean) => {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const preview = (
          pendingEditKey.getState(view.state)?.previews ?? []
        ).find((p) => p.callId === callId);
        // A rejected picture leaves nothing behind.
        for (const id of generatedIdsIn(preview?.proposal.text ?? ""))
          discardGeneratedImage(id);
        view.dispatch(
          view.state.tr.setMeta(pendingEditKey, { type: "remove", callId }),
        );
        if (learn && preview) decided(preview, () => false);
      });
      setStatuses((prev) => ({ ...prev, [callId]: "rejected" }));
    },
    [run, decided],
  );
  const reject = useCallback(
    (callId: string) => {
      remove(callId, true);
      optionsRef.current.onAnnounce?.("rejected", 1);
    },
    [remove],
  );
  const discard = useCallback(
    (callId: string) => remove(callId, false),
    [remove],
  );

  /** The slots (EditProposal.slot) of pictures that text has now taken
   *  in: the frame is the text's from here, the picture goes on. */
  const withdrawSlots = useCallback(
    (ids: Set<string>) => {
      const gone: string[] = [];
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const previews = pendingEditKey.getState(view.state)?.previews ?? [];
        for (const p of previews)
          if (
            p.proposal.slot &&
            p.proposal.image &&
            ids.has(p.proposal.image.id)
          )
            gone.push(p.callId);
        let tr = view.state.tr;
        for (const callId of gone)
          tr = tr.setMeta(pendingEditKey, { type: "remove", callId });
        if (gone.length > 0) view.dispatch(tr);
      });
      if (gone.length > 0)
        setStatuses((prev) => {
          const next = { ...prev };
          for (const callId of gone) next[callId] = "joined";
          return next;
        });
    },
    [run],
  );

  /** Slots no text took in (the request ended, or stopped, without it):
   *  they go, and their pictures with them. */
  const dropSlots = useCallback(() => {
    const left =
      run((ctx) =>
        (pendingEditKey.getState(ctx.get(editorViewCtx).state)?.previews ?? [])
          .filter((p) => p.proposal.slot)
          .map((p) => p.callId),
      ) ?? [];
    for (const callId of left) remove(callId, false);
  }, [run, remove]);

  /** A picture asked for next to text that is proposed and not decided
   *  yet - its anchor quoted from that text, which isn't in the document
   *  (ai/images.rs allows it): put into that proposal, on a line of its
   *  own, so the two are one proposal accepted or rejected together,
   *  rather than one that can't be placed. False when no such proposal
   *  is pending: the picture is shown as its own. */
  const joinPicture = useCallback(
    (callId: string, picture: EditProposal): boolean => {
      const { anchor, action } = picture;
      if (
        !picture.image ||
        !anchor ||
        (action !== "insert_after" && action !== "insert_before")
      )
        return false;
      let joined = false;
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        if (documentMarkdown(serializeBlocks(ctx, state.doc)).includes(anchor))
          return;
        const previews = pendingEditKey.getState(state)?.previews ?? [];
        for (const host of previews) {
          if (host.streaming || host.proposal.image) continue;
          const old = host.proposal.text ?? "";
          const text = joinedText(old, anchor, action, picture.text ?? "");
          if (text === null || !host.replacement.includes(old)) continue;
          view.dispatch(
            state.tr.setMeta(pendingEditKey, {
              type: "add",
              previews: [
                {
                  ...host,
                  proposal: { ...host.proposal, text },
                  replacement: host.replacement.replace(old, () => text),
                  revision: (host.revision ?? 0) + 1,
                },
              ],
            }),
          );
          joined = true;
          return;
        }
      });
      if (joined) setStatuses((prev) => ({ ...prev, [callId]: "joined" }));
      return joined;
    },
    [run],
  );

  /**
   * One sentence taken (true), kept as written (false) or undecided again
   * (null). Once every sentence of the proposal has a decision, it is
   * applied - the last ✓ / ✕ is the Accept; one that kept them all is a
   * rejection. Until then Accept (the card, the review bar, Ctrl/⌘+Enter)
   * takes the undecided ones. A proposal shown whole (index -1, its margin
   * card) has one decision: ✓ accepts it, ✕ rejects it.
   */
  const decide = useCallback(
    (callId: string, index: number, take: boolean | null) => {
      if (index < 0) {
        if (take === true) accept(callId);
        else if (take === false) reject(callId);
        return;
      }
      if (take !== null)
        optionsRef.current.onAnnounce?.(take ? "accepted" : "rejected", 1);
      let complete = false;
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(
          view.state.tr.setMeta(pendingEditKey, {
            type: "decide",
            callId,
            index,
            take,
          }),
        );
        const preview = (
          pendingEditKey.getState(view.state)?.previews ?? []
        ).find((p) => p.callId === callId);
        complete =
          !!preview?.sentences &&
          !preview.streaming &&
          preview.sentences.changes.every((c) => c.take !== null);
      });
      if (complete) applyAccept(callId);
    },
    [run, accept, applyAccept, reject],
  );

  // Reads the ids from the plugin's own state rather than the `previews`
  // mirror so the callback stays STABLE ([run] only): MilkdownEditor's
  // ProposalStream machine closes over it, and a rejectAll that changed
  // identity on every preview change would rebuild the machine mid-stream,
  // dropping its accumulated drafts.
  // `learn` as in `remove`: false when a new request supersedes them.
  const clearAll = useCallback(
    (learn: boolean) => {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const previews = pendingEditKey.getState(view.state)?.previews ?? [];
        for (const p of previews)
          for (const id of generatedIdsIn(p.proposal.text ?? ""))
            discardGeneratedImage(id);
        view.dispatch(view.state.tr.setMeta(pendingEditKey, { type: "clear" }));
        if (learn) for (const p of previews) decided(p, () => false);
        setStatuses((prev) => {
          const copy = { ...prev };
          for (const p of previews) copy[p.callId] = "rejected";
          return copy;
        });
      });
    },
    [run, decided],
  );
  const rejectAll = useCallback(() => {
    const count = reviewTotalRef.current;
    clearAll(true);
    if (count > 0) optionsRef.current.onAnnounce?.("rejected", count);
  }, [clearAll, reviewTotalRef]);
  const discardAll = useCallback(() => clearAll(false), [clearAll]);

  /** Accepts every currently pending preview, one transaction each (so a
   *  mid-batch failure - text one of them depended on changed - doesn't
   *  undo the ones that already landed). */
  const acceptAll = useCallback(() => {
    const taken = reviewCount.taken;
    let ok = false;
    for (const p of previews) if (applyAccept(p.callId)) ok = true;
    if (ok) optionsRef.current.onAnnounce?.("accepted", taken);
  }, [previews, applyAccept, reviewCount.taken]);

  /** Moves the review pointer by `delta` (wrapping; a fresh pointer starts
   *  at the first preview either way) and returns what it now points at, or
   *  null if there's nothing to navigate - the caller (MilkdownEditor)
   *  reveals that preview immediately, synchronously, rather than waiting
   *  on an effect: unlike accept/reject, moving the pointer doesn't change
   *  the navigable set, so there's nothing to wait for. */
  const step = useCallback(
    (delta: 1 | -1): PendingPreview | null => {
      if (decidable.length === 0) return null;
      const next =
        focusIndex === -1
          ? 0
          : (focusIndex + delta + decidable.length) % decidable.length;
      const preview = decidable[next];
      setFocusedCallId(preview.callId);
      return preview;
    },
    [decidable, focusIndex],
  );
  const focusNext = useCallback(() => step(1), [step]);
  const focusPrevious = useCallback(() => step(-1), [step]);

  /** Accept/reject the currently focused preview - the Quick Ask nav bar's
   *  primary buttons. Unlike focusNext/Previous, WHERE the pointer lands
   *  afterward depends on the plugin round-trip (dispatch -> decoration
   *  state -> onPreviewsChange -> this hook's reindex effect above), so
   *  there's no new preview to return synchronously; the caller reveals the
   *  result via an effect on `focusedPreview` instead. */
  const acceptFocused = useCallback(() => {
    if (focusedCallId) accept(focusedCallId);
  }, [focusedCallId, accept]);

  const rejectFocused = useCallback(() => {
    if (focusedCallId) reject(focusedCallId);
  }, [focusedCallId, reject]);

  /** Every known proposal's status in one object - what gets pushed to a
   *  detached chat window, which has no access to editor state and so can't
   *  derive "pending" from the live preview list itself. Live previews win
   *  over recorded terminal statuses. */
  const allStatuses = useMemo(() => {
    const merged: Record<string, PendingStatus> = { ...statuses };
    for (const preview of previews)
      merged[preview.callId] = preview.streaming ? "streaming" : "pending";
    return merged;
  }, [previews, statuses]);

  /** Per-callId view of `allStatuses` - what the local chat card asks; one
   *  merge rule, not two that could drift. */
  const status = useCallback(
    // A proposal this editor never showed - from a restored conversation,
    // or one that ended before this session - is no longer decidable.
    // Defaulting to "pending" offered live-looking Accept buttons that could
    // only fail. (A card arriving mid-request reads as streaming instead:
    // see ChatMessages.)
    (callId: string): PendingStatus => allStatuses[callId] ?? "expired",
    [allStatuses],
  );

  /** A proposal's sentences as the card lists them - null when it isn't
   *  pending or isn't shown sentence by sentence. */
  const sentences = useCallback(
    (callId: string) =>
      previews.find((p) => p.callId === callId && !p.streaming)?.sentences
        ?.changes ?? null,
    [previews],
  );

  return {
    previews,
    allStatuses,
    showPreviews,
    accept,
    decide,
    sentences,
    reviewStops,
    focusedStop,
    stopIndex,
    stepReview,
    pointReview,
    reviewCount,
    reject,
    discard,
    acceptAll,
    rejectAll,
    discardAll,
    joinPicture,
    withdrawSlots,
    dropSlots,
    status,
    syncFromPlugin,
    decidable,
    reviewed,
    reviewStreaming,
    picturesPainting,
    focusIndex,
    focusedPreview,
    focusNext,
    focusPrevious,
    acceptFocused,
    rejectFocused,
  };
}
