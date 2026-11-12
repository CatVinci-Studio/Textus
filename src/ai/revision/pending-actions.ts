import { editorViewCtx } from "@milkdown/kit/core";
import {
  carriesPictures,
  decidedChanges,
  placeProposals,
  type ProposalToPlace,
  type SelectionTarget,
} from "./pending-place";
import {
  pendingEditKey,
  sentenceTake,
  type PendingPreview,
} from "./pending-types";
import { recordStatuses, type RecordedStatus } from "./proposal-lifecycle";
import type { EditProposal } from "../types";
import {
  discardGeneratedImage,
  generatedAlt,
  generatedIdsIn,
  generatedImageData,
  generatedImageFailure,
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
import { writeAccept, type AcceptOutcome } from "./pending-accept";
import { settle } from "./settle-motion";
import { makeProposalJoins } from "./pending-join";
import type { PendingEditOptions } from "./usePendingEdits";

/** What a writer does with proposals, as plain functions over an
 *  environment. Built once per runner so each keeps its identity: one that
 *  changed mid-stream would drop the stream's drafts. */
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
     *  them back, and then that decision no longer stands. */
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

  /** The plugin's onPreviewsChange: the only way React learns of a preview
   *  dropped because the document changed under it. */
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
      // it again: its card follows.
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

  /** Accepts a proposal with pictures: each saved first, once, then the text
   *  written with their srcs. Waits for pictures still being made; ones that
   *  weren't made are left out. */
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

  // Applies without announcing: the callers say what was decided.
  const applyAccept = (
    callId: string,
    /** The proposal's text with only some of its sentence changes kept,
     *  composed against the target the preview resolved. */
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
    // A text of the caller's own says nothing about which changes it took.
    const learn = textOverride === undefined;
    const outcome = { current: null as AcceptOutcome | null };
    env.run((ctx) => {
      settle(ctx.get(editorViewCtx), [callId], () => {
        const written = writeAccept(
          ctx,
          callId,
          textOverride,
          env.options().citationStyle,
        );
        outcome.current = written;
        return written.ok || written.rejectedAll;
      });
    });
    const { ok, stillStreaming, rejectedAll, preview } = outcome.current ?? {
      ok: false,
      stillStreaming: false,
      rejectedAll: false,
    };
    const settled = { preview };
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
   *  rejected it, rather than a newer request, a refusal or a stop. */
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
      settle(view, [callId], () =>
        view.dispatch(
          view.state.tr.setMeta(pendingEditKey, { type: "remove", callId }),
        ),
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

  const { joinPicture, withdrawPictures, joinEdit } = makeProposalJoins(env);

  /** One sentence taken (true), kept (false) or undecided again (null). Once
   *  all are decided the proposal is applied; index -1 decides it whole. */
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

  // Reads the plugin's state, not `previews`, so the callback stays stable
  // and the stream machine isn't rebuilt mid-stream. `learn` as in `remove`.
  const clearAll = (learn: boolean) => {
    env.run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const previews = pendingEditKey.getState(view.state)?.previews ?? [];
      for (const p of previews)
        for (const id of generatedIdsIn(p.proposal.text ?? ""))
          discardGeneratedImage(id);
      settle(view, null, () =>
        view.dispatch(view.state.tr.setMeta(pendingEditKey, { type: "clear" })),
      );
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

  /** Accepts every pending preview, one transaction each, so a failure
   *  mid-batch doesn't undo the ones that landed. */
  const acceptAll = () => {
    const { previews, reviewCount } = env.latest();
    const taken = reviewCount.taken;
    let ok = false;
    for (const p of previews) if (applyAccept(p.callId)) ok = true;
    if (ok) env.options().onAnnounce?.("accepted", taken);
  };

  const focusNext = () => env.latest().step(1);
  const focusPrevious = () => env.latest().step(-1);

  /** Accept/reject the focused preview. Where the pointer lands depends on
   *  the plugin round-trip, so nothing is returned. */
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
