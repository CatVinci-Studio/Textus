import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PendingStatus } from "../../revision/usePendingEdits";
import type { ChatRestore } from "../chat-restore";
import type { ReopenTarget } from "../reopen-conversation";
import {
  CHAT_TO_EDITOR,
  sendToWindow,
  type ChatContext,
  type OpenDocumentMessage,
} from "./chat-bridge";
import { flushPendingWrites } from "../../../storage/pending-writes";
import { unlistenAll } from "../../../utils/tauri-events";
import type { ChatWindowHandoff } from "./useChatWindowHandoff";
import type { Strings } from "../../../i18n/strings";

/** How long a send waits for the editor to answer a context request before
 *  going out with the last pushed copy. Short: this is same-machine window
 *  IPC, and blocking a send on a window that has gone unresponsive would be
 *  worse than sending a slightly older document. */
const CONTEXT_REQUEST_TIMEOUT_MS = 400;

/**
 * The chat window talking back to the editor (ChatWindowApp): each
 * message addressed to the document it is about, a fresh context asked
 * for before a send, a conversation reopened from the history once its
 * document is on screen, the conversation handed back on close - and the
 * window's own pin and title.
 */
export function useChatWindowBridge({
  handoff,
  pinned,
  t,
}: {
  handoff: ChatWindowHandoff;
  pinned: boolean;
  t: Strings;
}) {
  const { context, statuses, editorLabel, conversation, contextWaiter } =
    handoff;

  /** Every doc-scoped message says which file it was meant for: this window
   *  serves several tabs, and the editor may have switched since. A request
   *  belongs to the document it was SENT about - recorded when its context
   *  arrives - and each proposal remembers it, so switching tabs while a
   *  reply streams can't send the rest of it (or a later Accept) elsewhere. */
  const docPath = context?.docPath ?? null;
  const contextRef = useRef(context);
  contextRef.current = context;
  const requestDocPath = useRef<string | null>(null);
  const proposalDocs = useRef(new Map<string, string | null>());

  // Closing the window hands the conversation back so the editor can re-embed
  // the panel instead of silently losing the exchange. The window is
  // destroyed once this resolves, so it first waits for the storage writes
  // this window still has on their way (the conversation's history entry,
  // the pin setting) - see storage/pending-writes.ts.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested(async () => {
      if (editorLabel.current)
        sendToWindow(editorLabel.current, CHAT_TO_EDITOR.reembed, {
          conversationId: conversation.conversationId,
          turns: conversation.history,
          docPath:
            requestDocPath.current ?? contextRef.current?.docPath ?? null,
        });
      await flushPendingWrites();
    });
    return unlistenAll(unlisten);
  }, [conversation.conversationId, conversation.history, editorLabel]);

  // Pin: a chat the user keeps beside their writing is worth nothing if it
  // disappears behind the editor the moment they click into the document.
  // The setting (not window-local state) so it survives closing the window.
  useEffect(() => {
    void getCurrentWindow().setAlwaysOnTop(pinned);
  }, [pinned]);

  // The title says which document this is currently about - the one piece of
  // "which file am I talking to" visible when the window is on another
  // monitor with the editor out of sight.
  const docTitle = context?.docTitle;
  useEffect(() => {
    void getCurrentWindow().setTitle(
      docTitle ? `${t.chatWindowTitle} - ${docTitle}` : t.chatWindowTitle,
    );
  }, [docTitle, t.chatWindowTitle]);

  const send = useCallback(
    (event: string, payload?: unknown) => {
      if (editorLabel.current)
        sendToWindow(editorLabel.current, event, payload);
    },
    [editorLabel],
  );

  const sendScoped = useCallback(
    (event: string, payload: object, scopedTo: string | null = docPath) =>
      send(event, { ...payload, docPath: scopedTo }),
    [send, docPath],
  );
  const sendForProposal = useCallback(
    (event: string, callId: string) =>
      sendScoped(
        event,
        { callId },
        proposalDocs.current.has(callId)
          ? (proposalDocs.current.get(callId) ?? null)
          : docPath,
      ),
    [sendScoped, docPath],
  );

  // A conversation picked from the history list waits here until the
  // editor has its document on screen: restored any earlier, its first save
  // would file it under whichever document the window was following. One
  // of a document never saved (or continued here) has nothing to wait for.
  const [reopening, setReopening] = useState<ChatRestore | null>(null);
  useEffect(() => {
    if (!reopening) return;
    if (reopening.docPath !== null && reopening.docPath !== docPath) return;
    setReopening(null);
    proposalDocs.current.clear();
    conversation.restore(reopening.id, reopening.turns);
  }, [reopening, docPath, conversation]);
  const reopenTarget: ReopenTarget = {
    restore: setReopening,
    openDocument: (path) =>
      send(CHAT_TO_EDITOR.openDocument, { path } satisfies OpenDocumentMessage),
  };

  /** Asks the active editor for its document/selection as they read right
   *  now, and resolves with the answer. See ChatBody's `refreshContext`. */
  const refreshContext = useCallback(
    () =>
      new Promise<ChatContext | null>((resolve) => {
        if (!editorLabel.current) return resolve(null);
        const timer = window.setTimeout(() => {
          contextWaiter.current = null;
          resolve(null);
        }, CONTEXT_REQUEST_TIMEOUT_MS);
        contextWaiter.current = (incoming) => {
          window.clearTimeout(timer);
          requestDocPath.current = incoming.docPath;
          resolve(incoming);
        };
        send(CHAT_TO_EDITOR.requestContext);
      }),
    [send, editorLabel, contextWaiter],
  );

  const proposalStatus = useCallback(
    (callId: string): PendingStatus => statuses[callId] ?? "expired",
    [statuses],
  );
  const pendingCount = useMemo(
    () => Object.values(statuses).filter((s) => s === "pending").length,
    [statuses],
  );

  return {
    docPath,
    requestDocPath,
    proposalDocs,
    sendScoped,
    sendForProposal,
    reopenTarget,
    refreshContext,
    proposalStatus,
    pendingCount,
  };
}
