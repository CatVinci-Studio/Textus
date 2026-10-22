import { editedText, reanchoredPicture } from "./joined-edit";
import { closeHistory } from "@milkdown/kit/prose/history";
import { editorViewCtx } from "@milkdown/kit/core";
import { visibleTextBetween } from "../../editor/markdown/link-reveal";
import {
  carriesPictures,
  decidedChanges,
  isAnchored,
  placeProposals,
  plainText,
  resolveAnchored,
  type ProposalToPlace,
  type SelectionTarget,
} from "./pending-place";

import {
  composeMarkdownEdit,
  documentMarkdown,
  findMarkdownMatch,
  serializeBlocks,
} from "../doc-markdown";
import { applyEditRange, replaceWithMarkdown } from "./apply-edit";

import {
  citationsAsFootnotes,
  footnoteLabels,
  hasCitations,
  withoutCitations,
} from "../citations";

import { isIOSApp } from "../../platform/capabilities";
import {
  pendingEditKey,
  sentenceTake,
  type PendingPreview,
} from "./pending-edit-plugin";
import { recordStatuses, type RecordedStatus } from "./proposal-lifecycle";
import { composeSentences, trimBreaks } from "./sentence-diff";
import { findInOrder } from "./sentence-locate";

import type { EditProposal } from "../types";
import {
  discardGeneratedImage,
  generatedAlt,
  generatedIdsIn,
  generatedImageData,
  generatedImageFailure,
  joinedText,
  pictureSrc,
  pictureState,
  loadGeneratedImage,
  rememberSaved,
  savedSrc,
  withSavedSrc,
  withoutPicture,
} from "./generated-images";

import type { EditorRunner } from "../../editor/useEditorRunner";

import type { Dispatch, SetStateAction } from "react";
import type { PendingEditOptions } from "./usePendingEdits";

/**
 * What a writer does with proposals - accept, reject, decide a sentence,
 * join a picture to the text it goes with - as plain functions over an
 * environment: the editor runner, the latest state and options, the
 * state's setters. usePendingEdits builds them once per runner, so each
 * keeps its identity: MilkdownEditor's ProposalStream closes over some of
 * them, and one that changed mid-stream rebuilt it and dropped its drafts.
 */
export interface PendingEnv {
  run: EditorRunner;
  options: () => PendingEditOptions;
  /** What this render of the hook sees. */
  latest: () => {
    previews: PendingPreview[];
    reviewCount: { taken: number; total: number };
    focusedCallId: string | null;
    step: (delta: 1 | -1) => PendingPreview | null;
  };
  setPreviews: Dispatch<SetStateAction<PendingPreview[]>>;
  setStatuses: Dispatch<SetStateAction<Record<string, RecordedStatus>>>;
  /** Kept across renders, never shown. */
  mutable: {
    /** Accepted proposals whose decision was reported: an undo can bring
     *  them back (syncFromPlugin), and then that decision no longer stands. */
    reportedAccepts: Set<string>;
    knownIds: Set<string>;
    /** Accepted pictures being saved, by call id: a second Accept while the
     *  first is still saving must not save a second copy. */
    savingImages: Set<string>;
  };
}

export function makePendingActions(env: PendingEnv) {
  const decided = (preview: PendingPreview, take: (i: number) => boolean) => {
    const changes = decidedChanges(preview, take);
    if (changes.length === 0) return;
    if (changes.some((c) => c.taken))
      env.mutable.reportedAccepts.add(preview.callId);
    env.options().onDecided?.(preview.callId, changes);
  };

  /** Wired (via a ref-indirected callback, see MilkdownEditor) to the
   *  plugin's onPreviewsChange - the only path React learns about a preview
   *  the plugin silently dropped because the document changed under it. */
  const syncFromPlugin = (next: PendingPreview[], applied: string[] = []) => {
    const nextIds = new Set(next.map((p) => p.callId));
    const dropped = [...env.mutable.knownIds].filter((id) => !nextIds.has(id));
    env.mutable.knownIds = nextIds;
    env.setPreviews(next);
    for (const id of nextIds)
      if (env.mutable.reportedAccepts.delete(id))
        env.options().onDecided?.(id, []);
    env.setStatuses((prev) => {
      const written = new Set(applied);
      let next = recordStatuses(
        prev,
        dropped.filter((id) => !written.has(id)),
        { type: "dropped", applied: false },
      );
      next = recordStatuses(
        next,
        dropped.filter((id) => written.has(id)),
        { type: "dropped", applied: true },
      );
      // An undo put an accepted proposal back on offer, a redo applied
      // it again: its card follows (pending-edit-plugin's `applied`).
      next = recordStatuses(next, nextIds, { type: "back" });
      return recordStatuses(
        next,
        applied.filter((id) => !nextIds.has(id)),
        { type: "applied" },
      );
    });
  };

  const showPreviews = (
    proposals: ProposalToPlace[],
    chatInfo: SelectionTarget | null,
  ) => {
    env.run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { placed, invalidIds } = placeProposals(
        ctx,
        view.state,
        proposals,
        chatInfo,
      );
      if (placed.length > 0) {
        view.dispatch(
          view.state.tr.setMeta(pendingEditKey, {
            type: "add",
            previews: placed,
          }),
        );
      }
      if (invalidIds.length > 0) {
        env.setStatuses((prev) =>
          recordStatuses(prev, invalidIds, {
            type: "decided",
            outcome: "invalid",
          }),
        );
      }
    });
  };

  /** The Accept of a proposal that carries pictures - a picture on its
   *  own, or text with pictures written into it (ai/images/inline.rs): each
   *  saved first (Settings › Images), then the text written with their
   *  srcs like any insertion. Not while one is still being made - Accept
   *  waits for it (the card says so) - and a picture that wasn't made is
   *  left out of the text it came with; a picture on its own that wasn't
   *  made has nothing to accept. Saved once: an undo that brings the
   *  proposal back, accepted again, writes the same files. */
  const acceptPictures = (callId: string, proposal: EditProposal): boolean => {
    let text = proposal.text ?? "";
    const ids = generatedIdsIn(text);
    if (ids.some((id) => pictureState(id) === "painting")) {
      for (const id of ids) void loadGeneratedImage(id);
      return false;
    }
    for (const id of ids)
      if (pictureState(id) === "failed") text = withoutPicture(text, id);
    if (!text.trim()) return false;
    const { storeImage, onImageError } = env.options();
    const unsaved = generatedIdsIn(text).filter((id) => !savedSrc(id));
    const write = (final: string) => {
      const written = applyAccept(callId, final);
      const old =
        written && proposal.image && proposal.action === "replace"
          ? pictureSrc(proposal.anchor ?? "")
          : null;
      if (old) env.options().onPictureReplaced?.(old);
      return written;
    };
    const withSaved = (markdown: string) =>
      generatedIdsIn(markdown).reduce(
        (t, id) => withSavedSrc(t, id, savedSrc(id)!),
        markdown,
      );
    if (unsaved.length === 0) return write(withSaved(text));
    if (!storeImage || env.mutable.savingImages.has(callId)) return false;
    env.mutable.savingImages.add(callId);
    void (async () => {
      try {
        for (const id of unsaved) {
          const data = generatedImageData(id);
          if (!data)
            throw new Error(
              generatedImageFailure(id) ?? "the picture is no longer available",
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
        env.mutable.savingImages.delete(callId);
      }
    })();
    return true;
  };

  // Applies without announcing: the callers below say what was decided -
  // a sentence's ✓ that completes its proposal was the one decision, an
  // Accept of everything one decision of many changes.
  const applyAccept = (
    callId: string,
    /** Partial acceptance: the proposal's text with only some of its
     *  sentence changes kept (the card's per-sentence picker). Composed
     *  against the same target the preview resolved. */
    textOverride?: string,
  ): boolean => {
    if (textOverride === undefined) {
      let pictures: EditProposal | null = null;
      env.run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const preview = pendingEditKey
          .getState(view.state)
          ?.previews.find((p) => p.callId === callId);
        if (preview && !preview.streaming && carriesPictures(preview))
          pictures = preview.proposal;
      });
      if (pictures) return acceptPictures(callId, pictures);
    }
    let ok = false;
    let stillStreaming = false;
    let rejectedAll = false;
    // A text of the caller's own says nothing about which changes it took.
    const learn = textOverride === undefined;
    const settled: { preview?: PendingPreview } = {};
    env.run((ctx) => {
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
      // Edited by the writer since it was proposed: each taken change in
      // its own place, back to front, and nothing else in the range -
      // composing the whole range would write their edits over.
      if (textOverride === undefined && preview.rebased && take) {
        const taken = preview.sentences!.changes.filter((_, i) => take[i]);
        let tr = state.tr;
        for (const c of [...taken].sort((a, b) => b.from - a.from))
          tr = replaceWithMarkdown(
            tr,
            ctx,
            c.from,
            c.to,
            withoutCitations(c.after).replace(/\s+$/, ""),
          );
        const landed = findInOrder(
          tr.doc,
          tr.mapping.map(preview.from, -1),
          tr.mapping.map(preview.to, 1),
          taken.map(
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
        closeHistory(tr);
        view.dispatch(tr.scrollIntoView());
        if (!isIOSApp) view.focus();
        ok = true;
        return;
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
        const cite = env.options().citationStyle?.();
        if (cite?.asFootnotes) {
          ({ text: replacement, definitions: footnotes } = citationsAsFootnotes(
            replacement,
            cite.sources,
            footnoteLabels(documentMarkdown(serializeBlocks(ctx, state.doc))),
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
          let proposal = p.proposal;
          let resolved = resolveAnchored(ctx, doc, blocks, proposal);
          // A picture after a paragraph this rewrite replaced, and left
          // out: by the new text's paragraph in the same place.
          const moved =
            !resolved && proposal.image
              ? reanchoredPicture(
                  proposal,
                  preview.proposal.anchor ?? "",
                  textOverride ?? preview.proposal.text ?? "",
                )
              : null;
          if (moved) {
            proposal = moved;
            resolved = resolveAnchored(ctx, doc, blocks, proposal);
          }
          if (!resolved) continue;
          const { range, replacement: text, strikeRange } = resolved;
          found.push({
            ...p,
            proposal,
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
      env.setStatuses((prev) =>
        recordStatuses(prev, [callId], {
          type: "decided",
          outcome: "rejected",
        }),
      );
      return true;
    }
    if (ok && learn && settled.preview) {
      const take = sentenceTake(settled.preview);
      decided(settled.preview, (i) => (i < 0 || !take ? true : take[i]));
    }
    env.setStatuses((prev) =>
      recordStatuses(prev, [callId], {
        type: "decided",
        outcome: ok ? "accepted" : "invalid",
      }),
    );
    return ok;
  };

  const accept = (callId: string, textOverride?: string): boolean => {
    const ok = applyAccept(callId, textOverride);
    if (ok) env.options().onAnnounce?.("accepted", 1);
    return ok;
  };

  /** Takes a proposal off the document as rejected. `learn`: the writer
   *  rejected it (Reject, ✕) - not a new request superseding it, the
   *  backend refusing it or a stop leaving nothing of it, which `discard`
   *  is for. */
  const remove = (
    callId: string,
    learn: boolean,
    status: "rejected" | "replaced" = "rejected",
  ) => {
    env.run((ctx) => {
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
    env.setStatuses((prev) =>
      recordStatuses(prev, [callId], { type: "decided", outcome: status }),
    );
  };
  const reject = (callId: string) => {
    remove(callId, true);
    env.options().onAnnounce?.("rejected", 1);
  };
  const discard = (callId: string) => remove(callId, false);
  /** Takes `callId`'s preview away for a newer proposal at its spot: it
   *  reads as replaced, not rejected - in its card and to the model. */
  const replace = (callId: string) => remove(callId, false, "replaced");

  /** A picture asked for next to text that is proposed and not decided
   *  yet - its anchor quoted from that text, which isn't in the document
   *  (ai/images.rs allows it): put into that proposal, on a line of its
   *  own, so the two are one proposal accepted or rejected together,
   *  rather than one that can't be placed. False when no such proposal
   *  is pending: the picture is shown as its own. */
  /** `callId`'s edit made in a proposal not decided yet whose text holds
   *  `anchor` (which the document doesn't): `rewrite` gives that text with
   *  the edit in it, or null for a proposal it doesn't fit. */
  const joinInto = (
    callId: string,
    anchor: string,
    rewrite: (text: string) => string | null,
  ): boolean => {
    let joined = false;
    env.run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const inDocument = documentMarkdown(
        serializeBlocks(ctx, state.doc),
      ).includes(anchor);
      const previews = pendingEditKey.getState(state)?.previews ?? [];
      for (const host of previews) {
        if (host.streaming || host.proposal.image || host.callId === callId)
          continue;
        // Document text this rewrite replaces is its text now, as the
        // user sees it (src-tauri tools.rs's propose_edit).
        const replaces =
          host.proposal.action === "replace" &&
          (host.proposal.anchor ?? "").includes(anchor);
        if (inDocument && !replaces) continue;
        const old = host.proposal.text ?? "";
        const text = rewrite(old);
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
    if (joined)
      env.setStatuses((prev) =>
        recordStatuses(prev, [callId], {
          type: "decided",
          outcome: "joined",
        }),
      );
    return joined;
  };

  const joinPicture = (callId: string, picture: EditProposal): boolean => {
    const { anchor, action } = picture;
    if (
      !picture.image ||
      !anchor ||
      (action !== "insert_after" && action !== "insert_before")
    )
      return false;
    return joinInto(callId, anchor, (text) =>
      joinedText(text, anchor, action, picture.text ?? ""),
    );
  };

  /** The pictures text proposals now carry, standing as proposals of
   *  their own too: a rewrite of the paragraph a picture not accepted yet
   *  stands by, which put the picture into its new text. The picture's own
   *  proposal gives way (joined), the picture goes on in the text. */
  const withdrawPictures = (ids: Set<string>, carriers: Set<string>) => {
    const gone: string[] = [];
    env.run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const previews = pendingEditKey.getState(view.state)?.previews ?? [];
      for (const p of previews)
        if (
          p.proposal.image &&
          ids.has(p.proposal.image.id) &&
          !carriers.has(p.callId)
        )
          gone.push(p.callId);
      let tr = view.state.tr;
      for (const callId of gone)
        tr = tr.setMeta(pendingEditKey, { type: "remove", callId });
      if (gone.length > 0) view.dispatch(tr);
    });
    if (gone.length > 0)
      env.setStatuses((prev) =>
        recordStatuses(prev, gone, { type: "decided", outcome: "joined" }),
      );
  };

  /** A text edit quoted from a proposal not decided yet - a request after
   *  it changing what it proposed, or going on from it (src-tauri
   *  tools.rs): made in that proposal, which now reads with it, rather
   *  than shown as an edit with nowhere to go. */
  const joinEdit = (callId: string, edit: EditProposal): boolean => {
    if (edit.image || !edit.anchor) return false;
    return joinInto(callId, edit.anchor, (text) => editedText(text, edit));
  };

  /**
   * One sentence taken (true), kept as written (false) or undecided again
   * (null). Once every sentence of the proposal has a decision, it is
   * applied - the last ✓ / ✕ is the Accept; one that kept them all is a
   * rejection. Until then Accept (the card, the review bar, Ctrl/⌘+Enter)
   * takes the undecided ones. A proposal shown whole (index -1, its margin
   * card) has one decision: ✓ accepts it, ✕ rejects it.
   */
  const decide = (callId: string, index: number, take: boolean | null) => {
    if (index < 0) {
      if (take === true) accept(callId);
      else if (take === false) reject(callId);
      return;
    }
    if (take !== null)
      env.options().onAnnounce?.(take ? "accepted" : "rejected", 1);
    let complete = false;
    env.run((ctx) => {
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
  };

  // Reads the ids from the plugin's own state rather than the `previews`
  // mirror so the callback stays STABLE ([run] only): MilkdownEditor's
  // ProposalStream machine closes over it, and a rejectAll that changed
  // identity on every preview change would rebuild the machine mid-stream,
  // dropping its accumulated drafts.
  // `learn` as in `remove`: false when a new request supersedes them.
  const clearAll = (learn: boolean) => {
    env.run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const previews = pendingEditKey.getState(view.state)?.previews ?? [];
      for (const p of previews)
        for (const id of generatedIdsIn(p.proposal.text ?? ""))
          discardGeneratedImage(id);
      view.dispatch(view.state.tr.setMeta(pendingEditKey, { type: "clear" }));
      if (learn) for (const p of previews) decided(p, () => false);
      env.setStatuses((prev) =>
        recordStatuses(
          prev,
          previews.map((p) => p.callId),
          { type: "decided", outcome: "rejected" },
        ),
      );
    });
  };
  const rejectAll = () => {
    const count = env.latest().reviewCount.total;
    clearAll(true);
    if (count > 0) env.options().onAnnounce?.("rejected", count);
  };
  const discardAll = () => clearAll(false);

  /** Accepts every currently pending preview, one transaction each (so a
   *  mid-batch failure - text one of them depended on changed - doesn't
   *  undo the ones that already landed). */
  const acceptAll = () => {
    const { previews, reviewCount } = env.latest();
    const taken = reviewCount.taken;
    let ok = false;
    for (const p of previews) if (applyAccept(p.callId)) ok = true;
    if (ok) env.options().onAnnounce?.("accepted", taken);
  };

  const focusNext = () => env.latest().step(1);
  const focusPrevious = () => env.latest().step(-1);

  /** Accept/reject the currently focused preview - the Quick Ask nav bar's
   *  primary buttons. Unlike focusNext/Previous, WHERE the pointer lands
   *  afterward depends on the plugin round-trip (dispatch -> decoration
   *  state -> onPreviewsChange -> this hook's reindex effect above), so
   *  there's no new preview to return synchronously; the caller reveals the
   *  result via an effect on `focusedPreview` instead. */
  const acceptFocused = () => {
    const { focusedCallId } = env.latest();
    if (focusedCallId) accept(focusedCallId);
  };

  const rejectFocused = () => {
    const { focusedCallId } = env.latest();
    if (focusedCallId) reject(focusedCallId);
  };

  return {
    syncFromPlugin,
    showPreviews,
    accept,
    reject,
    discard,
    replace,
    joinPicture,
    withdrawPictures,
    joinEdit,
    decide,
    rejectAll,
    discardAll,
    acceptAll,
    focusNext,
    focusPrevious,
    acceptFocused,
    rejectFocused,
  };
}

export type PendingActions = ReturnType<typeof makePendingActions>;
