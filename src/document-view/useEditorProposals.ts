import { useCallback, useEffect, useMemo, useRef } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { PendingEditCallbacks } from "./editor-extensions";
import { useAgentConversation } from "../ai/chat/useAgentConversation";
import {
  usePendingEdits,
  type CitationStyle,
  type DecidedChange,
  type SelectionTarget,
} from "../ai/revision/usePendingEdits";
import {
  pendingEditKey,
  stopRewrite,
  stoppedRewrite,
  streamPendingInsertText,
} from "../ai/revision/pending-edit-plugin";
import { ProposalStream } from "../ai/revision/proposal-stream";
import { isRefusal } from "../ai/revision/proposal-status";
import { isProposalTool } from "../ai/chat/proposal";
import type { EditProposal } from "../ai/types";
import type { StreamEvent } from "../platform/ipc";
import type { Settings } from "../settings/SettingsContext";
import { prefersReducedMotion } from "../ui/motion";
import { storeImage } from "../editor/images/image-plugin";
import { showMessage } from "../ui/app-dialog";
import { cachedDocumentMarkdown } from "../ai/doc-markdown";
import { offerOldPictureTrash } from "../ai/revision/old-picture";
import {
  noteBegunPicture,
  withBegunPictures,
} from "../ai/revision/generated-images";
import { errorText } from "../utils/error-text";
import { resolveStrings } from "../i18n/strings";
import { useLatest } from "../utils/hooks/useLatest";
import { announce } from "../ui/announce";
import { plural } from "../i18n/plural";

/** The editor's side of AI edits: the pending previews (usePendingEdits),
 *  the two conversations that propose them (the panel's and Quick Ask's),
 *  and the streaming that grows a proposal in the document as it arrives. */
export function useEditorProposals({
  run,
  pendingEditActionsRef,
  settingsRef,
  settings,
  filePath,
  onDecided,
  requestImageName,
}: {
  run: EditorRunner;
  pendingEditActionsRef: { current: PendingEditCallbacks };
  settingsRef: { readonly current: Settings };
  settings: Settings;
  filePath: string | null;
  /** The writer decided a proposal (useRevisionLearning). */
  onDecided?: (callId: string, changes: DecidedChange[]) => void;
  /** Asks for an accepted picture's file name, when Settings › Images
   *  says to ask. */
  requestImageName: (stem: string, extension: string) => Promise<string | null>;
}) {
  // How accepting writes a proposal's web citations: the setting the
  // proposal card sets, and the sources of the conversations here (kept
  // current below, once they exist).
  const citations = useRef<CitationStyle>({ asFootnotes: false, sources: [] });
  const citationStyle = useCallback(() => citations.current, []);
  const filePathRef = useLatest(filePath);
  // An accepted picture is stored as a pasted one is (Settings › Images):
  // into the image folder, or up to the image host.
  const pendingEdits = usePendingEdits(run, {
    onDecided,
    storeImage: (image, alt) =>
      storeImage(
        {
          name: alt || "image",
          type: image.mime,
          base64: () => Promise.resolve(image.dataBase64),
        },
        {
          docPath: () => filePathRef.current,
          settings: () => settingsRef.current,
          requestName: requestImageName,
          onError: () =>
            resolveStrings(settingsRef.current.language).imageSaveFailed,
        },
      ),
    onImageError: (err) => {
      const t = resolveStrings(settingsRef.current.language);
      void showMessage(`${t.imageSaveFailed}\n${errorText(err)}`, {
        tone: "error",
      });
    },
    onPictureReplaced: (oldSrc) =>
      void offerOldPictureTrash(
        oldSrc,
        filePathRef.current,
        resolveStrings(settingsRef.current.language),
        () =>
          run((ctx) =>
            cachedDocumentMarkdown(ctx, ctx.get(editorViewCtx).state.doc),
          ) ?? "",
      ),
    citationStyle,
    // What a decision did, said to a screen reader in the interface
    // language.
    onAnnounce: (kind, count) => {
      const t = resolveStrings(settingsRef.current.language);
      announce(
        plural(
          kind === "accepted"
            ? t.announceChangesAccepted
            : t.announceChangesRejected,
          count,
          settingsRef.current.language,
        ),
      );
    },
  });
  useEffect(() => {
    pendingEditActionsRef.current = {
      onAccept: pendingEdits.accept,
      onReject: pendingEdits.reject,
      onPreviewsChange: pendingEdits.syncFromPlugin,
      getFocusedCallId: () => pendingEdits.focusedPreview?.callId ?? null,
      onDecide: pendingEdits.decide,
      getFocusedSentence: () => pendingEdits.focusedStop,
    };
  }, [
    pendingEditActionsRef,
    pendingEdits.accept,
    pendingEdits.reject,
    pendingEdits.syncFromPlugin,
    pendingEdits.focusedPreview,
    pendingEdits.decide,
    pendingEdits.focusedStop,
  ]);
  // Switching how revisions show (Settings, or the review bar's menu)
  // redraws them.
  useEffect(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta(pendingEditKey, { type: "refocus" }));
    });
  }, [settings.revisionDisplay, run]);
  // The review bar's pointer is drawn in the text (the sentence's tints a
  // shade darker): redraw when it moves.
  const focusedStopKey = pendingEdits.focusedStop
    ? `${pendingEdits.focusedStop.callId}:${pendingEdits.focusedStop.index}`
    : null;
  useEffect(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta(pendingEditKey, { type: "refocus" }));
    });
  }, [focusedStopKey, run]);
  // Re-prompting supersedes, at the same spot: a new exchange's proposal
  // takes the place of an undecided one from before that it overlaps - the
  // new suggestion replaces the old one on screen instead of stacking under
  // it - and leaves the rest, elsewhere, for the user to decide: a picture
  // asked for after a paragraph that wasn't accepted yet must not take
  // that paragraph away (nor text a picture). Armed when an exchange
  // starts (the busy effects below for the embedded bar; onContextRequest
  // in useChatContextBridge for detached sends): the first preview add
  // that follows notes which previews came before it. Proposals of the
  // SAME exchange coexist as siblings. The superseded proposals read as
  // "rejected" everywhere downstream (chat cards, next request's status
  // notes).
  const supersedePending = useRef(false);
  const earlierPreviews = useRef<Set<string>>(new Set());
  // What a replace_selection proposal from the editor's own conversation
  // targets: recorded by whichever surface SENDS (Quick Ask's captured
  // selection, or the panel's live selection at send time), so a selection
  // made while the reply is still streaming can't redirect it.
  const requestTargetRef = useRef<SelectionTarget | null>(null);
  // The same, for a request from the detached window: the selection it was
  // shown when it asked for context, not whatever has been pushed since.
  const detachedTargetRef = useRef<SelectionTarget | null>(null);
  const addPreviews = useCallback(
    (
      proposals: {
        callId: string;
        proposal: EditProposal;
        streaming?: boolean;
      }[],
      target: SelectionTarget | null,
    ) => {
      // Shown at once, pictures too: one still painting, or not loaded
      // yet, is its frame in place (pending-picture.ts) until it comes -
      // the text around it doesn't wait for it.
      if (supersedePending.current) {
        supersedePending.current = false;
        earlierPreviews.current = new Set(
          run((ctx) =>
            (
              pendingEditKey.getState(ctx.get(editorViewCtx).state)?.previews ??
              []
            ).map((p) => p.callId),
          ) ?? [],
        );
      }
      // A rewrite stopped while it streamed in sentence by sentence offers
      // what it reads as on screen (stopRewrite) - also when the stopped
      // turn is shown again from the conversation - and one that completed
      // no sentence offers nothing.
      const shown = proposals.flatMap((p) => {
        const kept = p.streaming ? undefined : stoppedRewrite(p.callId);
        if (kept === undefined) return [p];
        if (kept === null) {
          pendingEdits.discard(p.callId);
          return [];
        }
        return [{ ...p, proposal: { ...p.proposal, text: kept } }];
      });
      // The text first, then each picture: one next to text proposed and
      // not decided yet - this batch's or an earlier one's - goes into it.
      // An edit of text proposed and not decided yet goes into that
      // proposal (joinEdit) - once it is whole: a streaming one has its
      // own preview until then.
      const text = shown.filter(
        (p) =>
          !p.proposal.image &&
          (p.streaming || !pendingEdits.joinEdit(p.callId, p.proposal)),
      );
      if (text.length > 0) pendingEdits.showPreviews(text, target);
      const pictures = shown.filter(
        (p) =>
          p.proposal.image &&
          (p.streaming || !pendingEdits.joinPicture(p.callId, p.proposal)),
      );
      if (pictures.length > 0) pendingEdits.showPreviews(pictures, target);
      // What came before and stands where these now do gives way to them.
      const added = new Set(shown.map((p) => p.callId));
      for (const id of supersededBy(added, earlierPreviews.current)) {
        earlierPreviews.current.delete(id);
        pendingEdits.discard(id);
      }
    },
    // Member functions only - all are stable per editor ([run]), and
    // depending on the whole `pendingEdits` object (fresh every render)
    // would destabilize the ProposalStream memo below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      pendingEdits.showPreviews,
      pendingEdits.discard,
      pendingEdits.joinPicture,
      pendingEdits.joinEdit,
      run,
    ],
  );
  /** The earlier previews `added` stand on: the same spot, of the same
   *  kind - text in place of text, a picture of a picture. */
  const supersededBy = useCallback(
    (added: Set<string>, earlier: Set<string>): string[] =>
      run((ctx) => {
        const previews =
          pendingEditKey.getState(ctx.get(editorViewCtx).state)?.previews ?? [];
        const now = previews.filter((p) => added.has(p.callId));
        return previews
          .filter((old) => earlier.has(old.callId) && !added.has(old.callId))
          .filter((old) => now.some((p) => sameSpot(old, p)))
          .map((old) => old.callId);
      }) ?? [],
    [run],
  );
  // A streaming propose_edit grows its green preview in the document while
  // the model is still writing it. All lifecycle decisions - when a draft is
  // placed, what a stop keeps, what a failure discards - live in the
  // ProposalStream machine (proposal-stream.ts); this hook only wires its
  // effects to the editor. Gated on the animation setting: off means
  // previews appear complete, at once.
  // propose_edit call ids awaiting their tool result, and what a refused
  // one does: the preview goes (discard is stable per editor; the model
  // never hears this status - annotateProposalStatuses skips refusals).
  const proposalCallIds = useRef(new Set<string>());
  const discardRefused = pendingEdits.discard;
  const proposalStream = useMemo(
    () =>
      new ProposalStream({
        // Pictures written into the text show as their frames, never as
        // the lines that ask for them (withBegunPictures).
        place: (callId, proposal) =>
          addPreviews(
            [
              {
                callId,
                proposal: {
                  ...proposal,
                  text: withBegunPictures(callId, proposal.text ?? ""),
                },
                streaming: true,
              },
            ],
            requestTargetRef.current,
          ),
        feed: (callId, text, done) =>
          streamPendingInsertText(
            callId,
            withBegunPictures(callId, text),
            done,
          ),
        finalize: (callId, proposal) => {
          const text = withBegunPictures(callId, proposal.text ?? "");
          const kept = stopRewrite(callId, text);
          if (kept) streamPendingInsertText(callId, kept, true);
          addPreviews(
            [{ callId, proposal: { ...proposal, text } }],
            requestTargetRef.current,
          );
        },
        discard: pendingEdits.discard,
      }),
    // requestTargetRef is a stable ref; addPreviews/discard are stable per
    // editor (useCallback on `run`).
    [addPreviews, pendingEdits.discard],
  );
  const handleStreamEvent = useCallback(
    (event: StreamEvent) => {
      // A picture written into a proposal's text is being made: its line
      // shows as its frame from here (withBegunPictures).
      if (event.type === "picture") {
        noteBegunPicture(event.callId, event.line, event.id, {
          width: event.width,
          height: event.height,
        });
        return;
      }
      // The step came back garbled and is asked for again: the drafts it
      // streamed must go, as when a request fails.
      if (event.type === "retry") {
        proposalStream.finish("failed");
        return;
      }
      // A propose_edit the backend refused (tools.rs: a cut-off `text`)
      // may already be on screen - streamed, or placed from its call turn
      // a moment before this result arrived. The model resends it; this
      // copy must go, with or without animation.
      if (
        event.type === "turn" &&
        event.turn.kind === "ToolCall" &&
        isProposalTool(event.turn.name)
      )
        proposalCallIds.current.add(event.turn.call_id);
      if (
        event.type === "turn" &&
        event.turn.kind === "ToolResult" &&
        proposalCallIds.current.has(event.turn.call_id)
      ) {
        proposalCallIds.current.delete(event.turn.call_id);
        if (isRefusal(event.turn.output)) discardRefused(event.turn.call_id);
        return;
      }
      // Reduced motion renders widgets instantly, so streamed drafts would
      // create animation entries nothing ever reveals (or settles).
      if (!settingsRef.current.enableEditAnimation || prefersReducedMotion())
        return;
      if (event.type === "toolStart")
        proposalStream.toolStart(event.callId, event.name);
      else if (event.type === "toolArgsDelta")
        proposalStream.argsDelta(event.callId, event.delta);
      else if (
        event.type === "turn" &&
        event.turn.kind === "ToolCall" &&
        event.turn.name === "propose_edit"
      )
        proposalStream.finalCall(event.turn.call_id, event.turn.arguments);
    },
    // settingsRef is a stable ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [proposalStream, discardRefused],
  );
  // Owned here rather than by the popup so a completed exchange can be saved
  // to history when the popup closes. Every ordinary NEW open resets it;
  // sidebar history restoration is the one path that deliberately resumes.
  const agentModel = settings.agentModels[settings.aiProvider] || undefined;
  const conversation = useAgentConversation(
    filePath,
    settings.agentWorkspaceRoot || null,
    settings.aiProvider,
    settings.enableWebSearch,
    agentModel,
    handleStreamEvent,
    pendingEdits.allStatuses,
  );
  // Quick Ask's own conversation: a one-off exchange at the caret, kept out
  // of the History list. "Continue in the panel" hands it to `conversation`
  // (expandQuickAsk), which is the one the panel, the detached window and
  // History share.
  const quickConversation = useAgentConversation(
    filePath,
    settings.agentWorkspaceRoot || null,
    settings.aiProvider,
    settings.enableWebSearch,
    agentModel,
    handleStreamEvent,
    pendingEdits.allStatuses,
    false,
  );
  useEffect(() => {
    citations.current = {
      asFootnotes: settings.sourcesAsFootnotes,
      sources: [...conversation.history, ...quickConversation.history].flatMap(
        (turn) => (turn.kind === "Assistant" ? (turn.sources ?? []) : []),
      ),
    };
  }, [
    settings.sourcesAsFootnotes,
    conversation.history,
    quickConversation.history,
  ]);
  // Exchange boundaries. Start (busy rising): arm the supersede flag so this
  // exchange's first proposal clears the undecided leftovers of the previous
  // one. End with drafts still open: a user stop keeps what was already
  // typed into the document (frozen as a decidable preview), a failure
  // discards it - Retry would otherwise duplicate the proposal. A normal
  // completion left the machine empty and finish is a no-op.
  useEffect(() => {
    if (conversation.busy) {
      supersedePending.current = true;
      return;
    }
    proposalStream.finish(conversation.error ? "failed" : "stopped");
  }, [conversation.busy, conversation.error, proposalStream]);
  useEffect(() => {
    if (quickConversation.busy) {
      supersedePending.current = true;
      return;
    }
    proposalStream.finish(quickConversation.error ? "failed" : "stopped");
  }, [quickConversation.busy, quickConversation.error, proposalStream]);
  // Proposals always resolve HERE, whether the chat that produced them is
  // the embedded popup or a detached window - one implementation of the
  // anchor/apply logic, addressed two ways (see chat-bridge.ts).
  const showProposals = useCallback(
    (proposals: { callId: string; proposal: EditProposal }[]) => {
      addPreviews(proposals, requestTargetRef.current);
    },
    [addPreviews],
  );

  return {
    pendingEdits,
    conversation,
    quickConversation,
    supersedePending,
    requestTargetRef,
    detachedTargetRef,
    addPreviews,
    showProposals,
  };
}

export type PendingEdits = ReturnType<typeof usePendingEdits>;

/** Whether two proposals stand on the same spot, of the same kind (text,
 *  or a picture): their ranges overlap - an insertion's point inside the
 *  other's range, or the same point as another insertion's. */
function sameSpot(
  a: { from: number; to: number; proposal: EditProposal },
  b: { from: number; to: number; proposal: EditProposal },
): boolean {
  if (!!a.proposal.image !== !!b.proposal.image) return false;
  const point = (p: { from: number; to: number }) => p.from === p.to;
  if (point(a) && point(b)) return a.from === b.from;
  if (point(a)) return b.from < a.from && a.from < b.to;
  if (point(b)) return a.from < b.from && b.from < a.to;
  return a.from < b.to && b.from < a.to;
}
