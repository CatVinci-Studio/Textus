import { useCallback, useRef } from "react";
import { thisWindow } from "../platform/this-window";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { useEditorProposals } from "./useEditorProposals";
import {
  cachedDocument,
  caretContext,
  headingAt,
  readSelection,
} from "../ai/doc-markdown";
import { useDetachedChat } from "../ai/chat/window/useDetachedChat";
import { readChatContext } from "../ai/chat/live-context";
import type { useInlineChat } from "../ai/chat/quick-ask/useInlineChat";
import type { SelectionTarget } from "../ai/revision/usePendingEdits";
import type { SelectionChipHandlers } from "../ai/chat/ChatComposer";
import type { Settings } from "../prefs/SettingsContext";
import type { Strings } from "../i18n/strings";
import { useLatest } from "../utils/hooks/useLatest";

/** What each chat surface is told about this document when it sends: Quick
 *  Ask's captured selection, the docked panel's live one, and the detached
 *  window's pushed context - with where a proposal coming back resolves. */
export function useChatContextBridge({
  run,
  inlineChat,
  proposals,
  filePath,
  docTitle,
  filePathRef,
  docTitleRef,
  isActiveRef,
  settings,
  t,
  selectionChip,
}: {
  run: EditorRunner;
  inlineChat: ReturnType<typeof useInlineChat>;
  proposals: ReturnType<typeof useEditorProposals>;
  filePath: string | null;
  docTitle: string;
  filePathRef: { readonly current: string | null };
  docTitleRef: { readonly current: string };
  isActiveRef: { readonly current: boolean };
  settings: Settings;
  t: Strings;
  /** The highlight the window's selection chip drives; a ref, since it is
   *  made after this. */
  selectionChip: { readonly current: SelectionChipHandlers | null };
}) {
  const {
    pendingEdits,
    conversation,
    supersedePending,
    requestTargetRef,
    detachedTargetRef,
    addPreviews,
  } = proposals;

  // Quick Ask sends against the selection it captured when it opened.
  const { sendContext } = inlineChat;
  const quickSendContext = useCallback(async () => {
    const sent = await sendContext();
    if (sent) {
      requestTargetRef.current = {
        range: sent.range,
        selectionMarkdown: sent.selectionMarkdown,
        cursor: sent.cursor?.pos ?? null,
      };
    }
    return sent;
  }, [sendContext, requestTargetRef]);

  // The docked panel sends against the document and selection as they read
  // at the moment of sending.
  const panelSendContext = useCallback(
    async () =>
      run((ctx) => {
        const { state } = ctx.get(editorViewCtx);
        const selection = readSelection(ctx, state);
        const caret = caretContext(state);
        requestTargetRef.current = {
          range: selection.range,
          selectionMarkdown: selection.selectionMarkdown,
          cursor: caret?.pos ?? null,
        };
        return {
          document: cachedDocument(ctx, state.doc),
          selectionMarkdown: selection.selectionMarkdown,
          cursor: caret,
          focusHeading: headingAt(state.doc, state.selection.from),
        };
      }) ?? null,
    [run, requestTargetRef],
  );

  // The selection last sent to the detached chat: its replace_selection
  // proposals resolve against this, not Quick Ask's.
  const sentSelection = useRef<SelectionTarget | null>(null);

  const detachedChat = useDetachedChat({
    // Every tab receives the chat's events. Match on path; an unsaved draft
    // has none, so the active tab stands in.
    isTarget: (docPath) =>
      docPath !== null ? docPath === filePathRef.current : isActiveRef.current,
    onProposals: (proposals) =>
      addPreviews(proposals, detachedTargetRef.current),
    onAccept: pendingEdits.accept,
    onReject: pendingEdits.reject,
    onAcceptAll: pendingEdits.acceptAll,
    onRejectAll: pendingEdits.rejectAll,
    // Forced push: the selection is usually unchanged but the document isn't.
    // It precedes every detached send, so it also arms the supersede flag;
    // only the active tab answers, or others would clear unrelated previews.
    onContextRequest: () => {
      if (!isActiveRef.current) return;
      supersedePending.current = true;
      forcePushLiveContextRef.current();
      detachedTargetRef.current = sentSelection.current;
    },
    selectionChip: {
      onChange: (chip) => selectionChip.current?.onChange(chip),
      onReveal: () => selectionChip.current?.onReveal(),
    },
    onReembed: (conversationId, turns, docPath) => {
      // The window's chip went with it.
      selectionChip.current?.onChange({ shown: false, hot: false });
      const mine =
        docPath !== null
          ? docPath === filePathRef.current
          : isActiveRef.current;
      if (mine && turns.length > 0) conversation.restore(conversationId, turns);
    },
  });

  // Destructured so effects depend on the stable callbacks, not the fresh
  // object the hook returns each render.
  const {
    chatLabel: detachedChatLabel,
    pushContext: pushChatContext,
    pushStatuses: pushChatStatuses,
  } = detachedChat;

  // Only the active tab pushes, or hidden tabs would announce their own
  // documents. What was last sent, so a push with nothing new is skipped:
  // selection changes fire on every transaction.
  const pushed = useRef<{ selection: string; docPath: string | null } | null>(
    null,
  );
  const pushLiveContext = useCallback(() => {
    if (!detachedChatLabel || !isActiveRef.current) return;
    // Guard before any serialization: this runs per keystroke, exactly when
    // the document cache misses.
    const selection = run((ctx) => {
      const { state } = ctx.get(editorViewCtx);
      return state.selection.empty
        ? ""
        : state.doc.textBetween(state.selection.from, state.selection.to, " ");
    });
    if (
      selection === undefined ||
      (pushed.current?.selection === selection &&
        pushed.current.docPath === filePathRef.current)
    ) {
      return;
    }
    const live = readChatContext(
      run,
      filePathRef.current,
      docTitleRef.current,
      thisWindow().label,
    );
    if (!live) return;
    pushed.current = { selection, docPath: live.context.docPath };
    // The selection the chat was shown; returning proposals are checked
    // against exactly it.
    sentSelection.current = live.selection;
    pushChatContext(live.context);
  }, [
    detachedChatLabel,
    pushChatContext,
    run,
    filePathRef,
    docTitleRef,
    isActiveRef,
  ]);

  /** Re-sends even when the guard sees no change: the document or the active
   *  tab changed instead. */
  const forcePushLiveContext = useCallback(() => {
    pushed.current = null;
    pushLiveContext();
  }, [pushLiveContext]);
  const forcePushLiveContextRef = useLatest(forcePushLiveContext);

  function handleDetachChat() {
    // The window opens against the live document, not Quick Ask's snapshot.
    const live = readChatContext(run, filePath, docTitle, thisWindow().label);
    if (!live) return;
    sentSelection.current = live.selection;
    void (async () => {
      try {
        await detachedChat.detach(
          {
            context: live.context,
            conversationId: conversation.conversationId,
            turns: conversation.history,
            statuses: pendingEdits.allStatuses,
          },
          t.chatWindowTitle,
          settings.pinAgentWindow,
        );
      } catch {
        // The window never opened: keep the bar, or pending edits would have
        // no accept/reject surface.
        return;
      }
      // chatInfo stays set so the window's proposals still resolve against
      // this request's context.
      inlineChat.hide();
    })();
  }

  return {
    quickSendContext,
    panelSendContext,
    detachedChatLabel,
    pushChatStatuses,
    pushLiveContext,
    forcePushLiveContext,
    handleDetachChat,
  };
}
