import { useCallback, useEffect, useMemo, useRef } from "react";
import { reportUndecided } from "../document/undecided";
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
import type { GeneratedImageData, StreamEvent } from "../platform/ipc";
import type { Settings } from "../prefs/SettingsContext";
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
import { resolveStrings } from "../i18n/strings";
import { useLatest } from "../utils/hooks/useLatest";
import { announce } from "../ui/announce";
import { plural } from "../i18n/plural";
import { usePluginDocumentAccess } from "./plugins/usePluginDocumentAccess";
import { useKeptProposals } from "../ai/revision/useKeptProposals";
import { explainError } from "../utils/error-explain";

/** The editor's side of AI edits: pending previews, the two conversations
 *  that propose them, and streaming proposals into the document. */
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
  /** The writer decided a proposal. */
  onDecided?: (callId: string, changes: DecidedChange[]) => void;
  /** Asks for an accepted picture's file name, when the settings say to. */
  requestImageName: (stem: string, extension: string) => Promise<string | null>;
}) {
  // How accepting writes a proposal's web citations.
  const citations = useRef<CitationStyle>({ asFootnotes: false, sources: [] });
  const citationStyle = useCallback(() => citations.current, []);
  const filePathRef = useLatest(filePath);
  /** A generated picture saved beside the document; its src, or null when
   *  naming it was cancelled. */
  const storePicture = (image: GeneratedImageData, alt: string) =>
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
    );
  const pendingEdits = usePendingEdits(run, {
    onDecided,
    storeImage: storePicture,
    onImageError: (err) => {
      const t = resolveStrings(settingsRef.current.language);
      void showMessage(`${t.imageSaveFailed}\n${explainError(err, t)}`, {
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
  const undecided = pendingEdits.decidable.length;
  useEffect(() => {
    if (filePath) reportUndecided(filePath, "ai", undecided);
  }, [filePath, undecided]);
  // The document's undecided proposals outlive closing it.
  useKeptProposals({
    run,
    filePath,
    workspaceRoot: settings.agentWorkspaceRoot || null,
    previews: pendingEdits.previews,
    showPreviews: pendingEdits.showPreviews,
    decide: pendingEdits.decide,
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
  useEffect(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta(pendingEditKey, { type: "refocus" }));
    });
  }, [settings.revisionDisplay, run]);
  // The review bar's pointer is drawn in the text: redraw when it moves.
  const focusedStopKey = pendingEdits.focusedStop
    ? `${pendingEdits.focusedStop.callId}:${pendingEdits.focusedStop.index}`
    : null;
  useEffect(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta(pendingEditKey, { type: "refocus" }));
    });
  }, [focusedStopKey, run]);
  // Re-prompting supersedes: a new exchange's proposal replaces an undecided
  // earlier one it overlaps, and leaves the rest for the user to decide.
  // Superseded proposals read as "replaced", not "rejected", downstream.
  const supersedePending = useRef(false);
  const earlierPreviews = useRef<Set<string>>(new Set());
  // Recorded at send time, so a selection made while the reply streams
  // can't redirect a replace_selection proposal.
  const requestTargetRef = useRef<SelectionTarget | null>(null);
  // The same, for a request from the detached window: the selection it was
  // shown when it asked for context, not whatever has been pushed since.
  const detachedTargetRef = useRef<SelectionTarget | null>(null);
  /** The earlier previews `added` stand on: same spot, same kind. */
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
  // Member functions only: the whole object is fresh every render and would
  // destabilize the ProposalStream memo below.
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
      // Shown at once: a picture not painted yet is its frame in place.
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
      // A rewrite stopped mid-stream offers what it reads as on screen; one
      // that completed no sentence offers nothing.
      const shown = proposals.flatMap((p) => {
        const kept = p.streaming ? undefined : stoppedRewrite(p.callId);
        if (kept === undefined) return [p];
        if (kept === null) {
          discard(p.callId);
          return [];
        }
        return [{ ...p, proposal: { ...p.proposal, text: kept } }];
      });
      // An edit of undecided text goes into that proposal, once it is
      // whole; a streaming one has its own preview until then.
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
  // Gives the ProposalStream machine the editor to draw a streaming
  // propose_edit in.
  const discardRefused = pendingEdits.discard;
  // Reduced motion renders widgets instantly: the typewriter's entries
  // would never be revealed (or settle).
  const animated = useCallback(
    () => settingsRef.current.enableEditAnimation && !prefersReducedMotion(),
    [settingsRef],
  );
  const proposalStream = useMemo(() => {
    // Pictures written into the text show as their frames.
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
    // per editor.
  }, [addPreviews, discardRefused, run, animated]);
  // Not memoized: the conversations read it through a ref.
  const handleStreamEvent = (event: StreamEvent) => {
    // A picture written into a proposal's text is being made: show its frame.
    if (event.type === "picture") {
      noteBegunPicture(event.callId, event.line, event.id, {
        width: event.width,
        height: event.height,
      });
      return;
    }
    // A garbled step is asked for again: drop its drafts, as on failure.
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
  // Owned here so a finished exchange is saved to history when the popup
  // closes. Only sidebar history restoration resumes one.
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
  // Quick Ask's one-off exchange, kept out of History. "Continue in the
  // panel" hands it to `conversation`.
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
  // Start: arm the supersede flag. End with drafts open: a user stop keeps
  // the typed text as a preview, a failure discards it so Retry doesn't
  // duplicate the proposal.
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
  // Proposals resolve here whether the chat is embedded or detached.
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
    storePicture,
  };
}

export type PendingEdits = ReturnType<typeof usePendingEdits>;

/** Whether two proposals stand on the same spot, of the same kind: their
 *  ranges overlap, or two insertions share a point. */
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
