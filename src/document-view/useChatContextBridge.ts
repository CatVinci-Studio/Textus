import { useCallback, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
import type { Settings } from "../settings/SettingsContext";
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
  /** The highlight the window's selection chip drives
   *  (useChatSelectionHighlight) - a ref, since it is made after this. */
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
  const quickSendContext = useCallback(async () => {
    const sent = await inlineChat.sendContext();
    if (sent) {
      requestTargetRef.current = {
        range: sent.range,
        selectionMarkdown: sent.selectionMarkdown,
        cursor: sent.cursor?.pos ?? null,
      };
    }
    return sent;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineChat.sendContext]);

  // The docked panel sends against the document and selection as they read
  // at the moment of sending - it follows the user's work, like the
  // detached window, but reads its own editor directly.
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

  // The selection this window last SENT to the detached chat. A
  // replace_selection proposal from that window has to resolve against it
  // and not against Quick Ask's: the tab the window is asking about may
  // never have opened Quick Ask at all, and the rewrite would then come
  // back un-appliable with nothing on screen explaining why.
  const sentSelection = useRef<SelectionTarget | null>(null);

  const detachedChat = useDetachedChat({
    // Every open tab in this window receives the chat's events, and with one
    // chat window serving several files they are NOT all for this tab.
    // Matching on the path the chat addressed is exact whenever the document
    // has one; an unsaved draft has no path to match, so the active tab (the
    // only one the chat could have been showing) stands in. The hook applies
    // this before dispatching any doc-scoped handler below, so none of them
    // can forget the check.
    isTarget: (docPath) =>
      docPath !== null ? docPath === filePathRef.current : isActiveRef.current,
    onProposals: (proposals) =>
      addPreviews(proposals, detachedTargetRef.current),
    onAccept: pendingEdits.accept,
    onReject: pendingEdits.reject,
    onAcceptAll: pendingEdits.acceptAll,
    onRejectAll: pendingEdits.rejectAll,
    // A send is about to go out and needs the document as it reads NOW - not
    // as it read when the selection last changed. Forced: the selection is
    // usually unchanged, but the document almost certainly isn't. The
    // request only ever precedes a send, so it doubles as the detached
    // window's exchange-start signal for the supersede flag - a detached
    // send runs in the chat window's own conversation and never flips this
    // editor's `conversation.busy` (whose rising edge arms the embedded
    // bar's sends, in useEditorProposals' busy effects).
    // Only the active tab answers: the request goes to every editor in the
    // window, and arming the others' supersede flag made their next proposal
    // silently clear previews that had nothing to do with this exchange.
    onContextRequest: () => {
      if (!isActiveRef.current) return;
      supersedePending.current = true;
      forcePushLiveContextRef.current();
      detachedTargetRef.current = sentSelection.current;
    },
    // The window handed its conversation back on close. Closing means
    // closing: the exchange quietly becomes this document's conversation
    // again (the panel shows it next time), instead of a Quick Ask bar
    // popping up - in every tab, as it used to.
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

  // Destructured so the effects that use them can depend on the individual,
  // stable callbacks. The hook's return value is a fresh object literal each
  // render, and depending on THAT re-ran those every render - emitting a
  // bridge event per render rather than per actual change.
  const {
    chatLabel: detachedChatLabel,
    pushContext: pushChatContext,
    pushStatuses: pushChatStatuses,
  } = detachedChat;

  // The detached window holds no editor state of its own: what it shows is
  // whatever the ACTIVE editor last told it. Pushing from here is therefore
  // also how the window learns which file it is about - one message carries
  // the document, the live selection, the title and the reply address (see
  // chat-bridge.ts).
  //
  // Only the active tab may push. Otherwise every hidden tab in the window
  // would announce its own document too, and the last one to render would
  // win - the chat would show a file the user isn't looking at.
  //
  // What was last sent, so a push saying nothing new can be skipped. The
  // whole document is cheap to re-read (live-context caches it against the
  // ProseMirror doc, which is immutable), but the emit JSON-encodes it and
  // the chat window re-renders on receipt - and ProseMirror reports a
  // selection change for EVERY transaction, so typing and drag-selecting
  // would each fire one per keystroke/mousemove.
  const pushed = useRef<{ selection: string; docPath: string | null } | null>(
    null,
  );
  const pushLiveContext = useCallback(() => {
    if (!detachedChatLabel || !isActiveRef.current) return;
    // The guard runs BEFORE any serialization: selectionUpdated fires on
    // every transaction, so this path also runs per keystroke - and typing
    // replaces the doc, which is exactly when the document cache inside
    // readChatContext misses. The plain-text selection and the path are all
    // the guard needs, and both are cheap reads.
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
      getCurrentWindow().label,
    );
    if (!live) return;
    pushed.current = { selection, docPath: live.context.docPath };
    // Remembered here, not derived later: this is the selection the chat was
    // actually shown, and a replace_selection proposal coming back is checked
    // for staleness against exactly it.
    sentSelection.current = live.selection;
    pushChatContext(live.context);
    // run is stable per editor; filePathRef/isActiveRef are refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detachedChatLabel, pushChatContext, run]);

  /** Re-sends even when nothing the guard tracks has changed - for the two
   *  callers where something ELSE did: the document (a send is imminent) or
   *  which tab is active. */
  const forcePushLiveContext = useCallback(() => {
    pushed.current = null;
    pushLiveContext();
  }, [pushLiveContext]);
  const forcePushLiveContextRef = useLatest(forcePushLiveContext);

  function handleDetachChat() {
    // The window opens against the document as it reads NOW, not against the
    // snapshot Quick Ask took when it opened - it is the cross-file surface
    // and starts by following this file, so it must start from the truth.
    const live = readChatContext(
      run,
      filePath,
      docTitle,
      getCurrentWindow().label,
    );
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
        // The window never opened. Keeping the bar is the point: hiding it
        // anyway would leave pending edits with no accept/reject surface at
        // all, which is only ever safe once the window that takes them over
        // actually exists.
        return;
      }
      // The Quick Ask bar gives way to the window; chatInfo stays set so
      // proposals arriving from the window still resolve against this
      // request's context.
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
