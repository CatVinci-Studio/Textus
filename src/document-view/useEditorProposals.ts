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
  stoppedRewrite,
} from "../ai/revision/pending-edit-plugin";
import { ProposalStream } from "../ai/revision/proposal-stream";
import {
  drawn,
  perCall,
  typewriter,
  type ProposalCanvas,
} from "../ai/revision/proposal-display";
import { isRefusal } from "../ai/revision/proposal-status";
import { isProposalTool } from "../ai/chat/proposal";
import type { EditProposal } from "../ai/types";
import type { StreamEvent } from "../platform/ipc";
import type { Settings } from "../settings/SettingsContext";
import { prefersReducedMotion } from "../ui/motion";
import { storeImage } from "../editor/images/image-plugin";
import { showMessage } from "../ui/app-dialog";
import { cachedDocument, cachedDocumentMarkdown } from "../ai/doc-markdown";
import { offerOldPictureTrash } from "../ai/revision/old-picture";
import {
  generatedIdsIn,
  noteBegunPicture,
  withBegunPictures,
} from "../ai/revision/generated-images";
import { errorText } from "../utils/error-text";
import { resolveStrings } from "../i18n/strings";
import { useLatest } from "../utils/hooks/useLatest";
import { announce } from "../ui/announce";
import { plural } from "../i18n/plural";
import { usePluginDocumentAccess } from "./usePluginDocumentAccess";

/** The editor's side of AI edits: the pending previews (usePendingEdits),
 *  the two conversations that propose them (the panel's and Quick Ask's),
 *  and the streaming that grows a proposal in the document as it arrives. */
export function useEditorProposals({
  run,
  pendingEditActionsRef,
  settingsRef,
  settings,
  filePath,
  isActive,
  onDecided,
  requestImageName,
}: {
  run: EditorRunner;
  pendingEditActionsRef: { current: PendingEditCallbacks };
  settingsRef: { readonly current: Settings };
  settings: Settings;
  filePath: string | null;
  /** The active tab's editor: the one plugins read and propose edits to. */
  isActive: boolean;
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
  // "replaced" downstream (chat cards, next request's status notes): told
  // "rejected", the model took the user to have turned that version down.
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
  // Member functions only - all are stable per editor ([run]), and
  // depending on the whole `pendingEdits` object (fresh every render)
  // would destabilize the ProposalStream memo below.
  const {
    showPreviews,
    discard,
    replace,
    joinPicture,
    joinEdit,
    withdrawPictures,
  } = pendingEdits;
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
          discard(p.callId);
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
          !p.proposal.image && (p.streaming || !joinEdit(p.callId, p.proposal)),
      );
      if (text.length > 0) showPreviews(text, target);
      const pictures = shown.filter(
        (p) =>
          p.proposal.image &&
          (p.streaming || !joinPicture(p.callId, p.proposal)),
      );
      if (pictures.length > 0) showPreviews(pictures, target);
      // A picture text now carries gives way as a proposal of its own.
      const carried = new Set(
        text.flatMap((p) => generatedIdsIn(p.proposal.text ?? "")),
      );
      if (carried.size > 0)
        withdrawPictures(carried, new Set(text.map((p) => p.callId)));
      // What came before and stands where these now do gives way to them.
      const added = new Set(shown.map((p) => p.callId));
      for (const id of supersededBy(added, earlierPreviews.current)) {
        earlierPreviews.current.delete(id);
        replace(id);
      }
    },
    [
      showPreviews,
      discard,
      replace,
      joinPicture,
      joinEdit,
      withdrawPictures,
      supersededBy,
      run,
    ],
  );
  // A streaming propose_edit grows its green preview in the document while
  // the model is still writing it. All lifecycle decisions - when a draft is
  // placed, what a stop keeps, what a failure discards - live in the
  // ProposalStream machine (proposal-stream.ts); how a draft is shown -
  // typed in, or drawn again as it grows with the animation off - in
  // proposal-display.ts. This hook gives them the editor to draw in.
  const discardRefused = pendingEdits.discard;
  // Reduced motion renders widgets instantly: the typewriter's entries
  // would never be revealed (or settle).
  const animated = useCallback(
    () => settingsRef.current.enableEditAnimation && !prefersReducedMotion(),
    [settingsRef],
  );
  const proposalStream = useMemo(() => {
    // Pictures written into the text show as their frames, never as the
    // lines that ask for them (withBegunPictures).
    const canvas: ProposalCanvas = {
      text: withBegunPictures,
      show: (callId, proposal, streaming) =>
        addPreviews(
          [
            {
              callId,
              proposal: {
                ...proposal,
                text: withBegunPictures(callId, proposal.text ?? ""),
              },
              streaming: streaming || undefined,
            },
          ],
          requestTargetRef.current,
        ),
      discard: discardRefused,
    };
    return new ProposalStream(
      perCall(
        { typewriter: typewriter(canvas), drawn: drawn(canvas) },
        animated,
      ),
      () =>
        run(
          (ctx) => cachedDocument(ctx, ctx.get(editorViewCtx).state.doc).blocks,
        ) ?? [],
    );
    // requestTargetRef is a stable ref; addPreviews and discard are stable
    // per editor (useCallback on `run`).
  }, [addPreviews, discardRefused, run, animated]);
  // Each stream event, into the machine. Not memoized: the conversations
  // read it through a ref (useAgentConversation's useLatest).
  const handleStreamEvent = (event: StreamEvent) => {
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
    if (event.type === "turn" && event.turn.kind === "ToolResult")
      proposalStream.result(event.turn.call_id, isRefusal(event.turn.output));
    else if (event.type === "toolStart")
      proposalStream.toolStart(event.callId, event.name);
    else if (event.type === "toolArgsDelta")
      proposalStream.argsDelta(event.callId, event.delta);
    else if (
      event.type === "turn" &&
      event.turn.kind === "ToolCall" &&
      isProposalTool(event.turn.name)
    )
      proposalStream.finalCall(event.turn.call_id, event.turn.arguments);
  };
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
  // A plugin's edits are proposals too, shown as Textus AI's are.
  usePluginDocumentAccess({ run, isActive, filePath, addPreviews });

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
