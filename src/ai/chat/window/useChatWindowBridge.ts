import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { thisWindow } from "../../../platform/this-window";
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
import { unlistenAll } from "../../../platform/events";
import type { ChatWindowHandoff } from "./useChatWindowHandoff";
import type { Strings } from "../../../i18n/strings";

/** How long a send waits for fresh context before using the last pushed copy.
 *  A slightly older document beats blocking on an unresponsive window. */
const CONTEXT_REQUEST_TIMEOUT_MS = 400;

/** The chat window's side of the editor bridge, plus its own pin and title. */
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

  // A request belongs to the document it was sent about, and each proposal
  // remembers it, so a tab switch mid-reply can't misdirect a later Accept.
  const docPath = context?.docPath ?? null;
  const contextRef = useRef(context);
  contextRef.current = context;
  const requestDocPath = useRef<string | null>(null);
  const proposalDocs = useRef(new Map<string, string | null>());

  // Closing hands the conversation back for re-embedding. The window dies once
  // this resolves, so pending storage writes are flushed first.
  useEffect(() => {
    const win = thisWindow();
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

  useEffect(() => {
    void thisWindow().setAlwaysOnTop(pinned);
  }, [pinned]);

  const docTitle = context?.docTitle;
  useEffect(() => {
    void thisWindow().setTitle(
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

  // A reopened conversation waits until its document is on screen; restored
  // earlier, its first save would file it under the wrong document.
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

  /** Asks the editor for its current context; null on timeout. */
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
