import type { DocumentReporting } from "./useDocumentReporting";
import { useCallback, useEffect, useRef } from "react";
import { reportUndecided } from "../document/undecided";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { PendingEditCallbacks } from "./editor-extensions";
import {
  useLiveConversation,
  useOwnConversation,
} from "../ai/chat/conversation/useConversation";
import type { DocumentPort } from "../ai/chat/conversation/document-port";
import {
  usePendingEdits,
  type CitationStyle,
} from "../ai/revision/usePendingEdits";
import type { DecidedChange } from "../ai/revision/pending-place";
import { pendingEditKey } from "../ai/revision/pending-types";
import type { EditProposal } from "../ai/types";
import type { GeneratedImageData } from "../platform/ipc";
import type { Settings } from "../prefs/SettingsContext";
import { storeImage } from "../editor/images/image-store";
import { showMessage } from "../engine/controls/app-dialog";
import { cachedDocumentMarkdown } from "../editor/markdown/doc-markdown";
import { offerOldPictureTrash } from "../ai/revision/old-picture";
import { resolveStrings } from "../i18n/strings";
import { useLatest } from "../utils/hooks/useLatest";
import { announce } from "../engine/controls/announce";
import { plural } from "../i18n/plural";
import { useAddPreviews, useDocumentPort } from "./useProposalFlow";
import { useEditorPluginDocument } from "./plugins/usePluginDocumentAccess";
import { noteBase } from "../ai/chat/file-changes";
import { useKeptProposals } from "../ai/revision/useKeptProposals";
import { explainError } from "../utils/error-explain";
import { aiRoot, useAiRoot } from "../ai/workspace/ai-root";

/** How accepting writes a proposal's web citations: kept as the replies
 *  arrive, read as one is accepted. */
function useCitationStyle() {
  const citations = useRef<CitationStyle>({ asFootnotes: false, sources: [] });
  const citationStyle = useCallback(() => citations.current, []);
  return { citations, citationStyle };
}

type Options = {
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
  /** What a save would write (useDocumentReporting). */
  textOf: DocumentReporting["textOf"];
};

/** The pending previews, accepted pictures saved beside the document, and
 *  the count left undecided reported for the file. */
function usePending(
  { run, settingsRef, filePath, onDecided, requestImageName }: Options,
  citationStyle: () => CitationStyle,
) {
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
  return { pendingEdits, storePicture };
}

/** What becomes of the previews: written straight in (direct mode), kept
 *  past closing, decided from the plugin, redrawn as the display or the
 *  review bar's pointer moves. */
function usePreviewUpkeep(
  { run, settings, filePath, pendingEditActionsRef }: Options,
  pendingEdits: PendingEdits,
  workspaceRoot: string | null,
) {
  // Written straight in: each proposal Textus AI sends now taken once the
  // backend has taken it whole, the text before the first kept for the
  // marks. Restored or placed ones (from before the switch), and drafts a
  // Stop cut off, stay for the writer to decide.
  const direct = settings.aiChangeMode === "direct";
  const sentNow = useRef(new Set<string>());
  const markSent = useCallback((callId: string) => {
    sentNow.current.add(callId);
  }, []);
  const { previews, accept } = pendingEdits;
  useEffect(() => {
    if (!direct) return;
    const ready = previews.filter(
      (p) => !p.streaming && sentNow.current.has(p.callId),
    );
    if (!ready.length) return;
    const before = run((ctx) =>
      cachedDocumentMarkdown(ctx, ctx.get(editorViewCtx).state.doc),
    );
    if (filePath && before !== undefined) noteBase(filePath, before);
    for (const preview of ready)
      if (accept(preview.callId)) sentNow.current.delete(preview.callId);
  }, [direct, previews, accept, run, filePath]);
  // The document's undecided proposals outlive closing it.
  useKeptProposals({
    run,
    filePath,
    workspaceRoot,
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
  return markSent;
}

/** The conversations that propose edits: the window's live one, read here
 *  (it outlives this editor; followed by its turns, never each frame of a
 *  reply), and Quick Ask's one-off exchange, kept out of History
 *  ("Continue in the panel" hands it to the live one). */
function useConversations(
  { settings, settingsRef, filePath }: Options,
  {
    workspaceRoot,
    port,
    citations,
    armSupersede,
    markSent,
    addRequested,
  }: {
    workspaceRoot: string | null;
    port: DocumentPort;
    citations: { current: CitationStyle };
    armSupersede: () => void;
    markSent: (callId: string) => void;
    addRequested: (
      proposals: { callId: string; proposal: EditProposal }[],
    ) => void;
  },
) {
  const conversation = useLiveConversation(filePath, workspaceRoot, false);
  const quickConversation = useOwnConversation(
    () => ({
      docPath: filePath,
      workspaceRoot: aiRoot(settingsRef.current),
      settings: settingsRef.current,
      port,
    }),
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
    citations,
    settings.sourcesAsFootnotes,
    conversation.history,
    quickConversation.history,
  ]);
  // Start: arm the supersede flag. The end comes from the reply itself
  // (port.onReplyEnd), not from whichever conversation is on screen.
  useEffect(() => {
    if (conversation.busy || quickConversation.busy) armSupersede();
  }, [conversation.busy, quickConversation.busy, armSupersede]);
  // Proposals resolve here whether the chat is embedded or detached.
  const showProposals = useCallback(
    (proposals: { callId: string; proposal: EditProposal }[]) => {
      for (const { callId } of proposals) markSent(callId);
      addRequested(proposals);
    },
    [markSent, addRequested],
  );
  return { conversation, quickConversation, showProposals };
}

/** The editor's side of AI edits: pending previews, the conversations that
 *  propose them (the window's live one, and Quick Ask's own), and streaming
 *  proposals into the document. */
export function useEditorProposals(options: Options) {
  const { run, settings, filePath, isActive, textOf } = options;
  const workspaceRoot = useAiRoot(settings);
  const { citations, citationStyle } = useCitationStyle();
  const { pendingEdits, storePicture } = usePending(options, citationStyle);
  const markSent = usePreviewUpkeep(options, pendingEdits, workspaceRoot);
  const {
    supersedePending,
    requestTargetRef,
    detachedTargetRef,
    addPreviews,
    addRequested,
    armSupersede,
  } = useAddPreviews(run, pendingEdits);
  const port = useDocumentPort({
    run,
    filePath,
    addRequested,
    discard: pendingEdits.discard,
    markSent,
    allStatuses: pendingEdits.allStatuses,
  });
  const { conversation, quickConversation, showProposals } = useConversations(
    options,
    { workspaceRoot, port, citations, armSupersede, markSent, addRequested },
  );
  // A plugin's edits are proposals too, shown as Textus AI's are.
  useEditorPluginDocument({ run, isActive, filePath, addPreviews, textOf });

  return {
    workspaceRoot,
    pendingEdits,
    conversation,
    quickConversation,
    port,
    supersedePending,
    requestTargetRef,
    detachedTargetRef,
    addPreviews,
    showProposals,
    storePicture,
  };
}

export type PendingEdits = ReturnType<typeof usePendingEdits>;
