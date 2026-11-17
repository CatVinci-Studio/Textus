import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setWindowTitle, thisWindow } from "../../../platform/this-window";
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
import { useFilesToEditor } from "./files-to-editor";
import { unlistenAll } from "../../../platform/events";
import type { ChatWindowHandoff } from "./useChatWindowHandoff";
import type { Strings } from "../../../i18n/strings";

/** How long a send waits for fresh context before using the last pushed copy.
 *  A slightly older document beats blocking on an unresponsive window. */
const CONTEXT_REQUEST_TIMEOUT_MS = 400;

type EditorLabel = ChatWindowHandoff["editorLabel"];
type Send = (event: string, payload?: unknown) => void;

/** Messages to the editor's window: as they are, scoped to the document
 *  in front, or to the document a proposal was made about. */
function useSendToEditor(editorLabel: EditorLabel, docPath: string | null) {
  const proposalDocs = useRef(new Map<string, string | null>());
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
  return { send, sendScoped, sendForProposal, proposalDocs };
}

/** Asks the editor for its current context; null on timeout. Two sends
 *  at once share the one ask: the editor answers it once. The document a
 *  request was sent about is kept. */
function useRefreshContext(
  send: Send,
  editorLabel: EditorLabel,
  contextWaiter: ChatWindowHandoff["contextWaiter"],
) {
  const requestDocPath = useRef<string | null>(null);
  const asking = useRef<Promise<ChatContext | null> | null>(null);
  const refreshContext = useCallback(
    () =>
      (asking.current ??= new Promise<ChatContext | null>((resolve) => {
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
      }).finally(() => {
        asking.current = null;
      })),
    [send, editorLabel, contextWaiter],
  );
  return { refreshContext, requestDocPath };
}

/** Closing hands the conversation back for re-embedding. The window dies
 *  once this resolves, so pending storage writes are flushed first.
 *  Listened for once: one listener at every moment, the conversation read
 *  as it then is. */
function useHandBackOnClose({
  editorLabel,
  conversation,
  context,
  requestDocPath,
}: {
  editorLabel: EditorLabel;
  conversation: ChatWindowHandoff["conversation"];
  context: ChatWindowHandoff["context"];
  requestDocPath: { readonly current: string | null };
}) {
  const now = useRef({ conversation, context });
  now.current = { conversation, context };
  useEffect(() => {
    const win = thisWindow();
    const unlisten = win.onCloseRequested(async () => {
      const { conversationId, history } = now.current.conversation;
      if (editorLabel.current)
        sendToWindow(editorLabel.current, CHAT_TO_EDITOR.reembed, {
          conversationId,
          turns: history,
          docPath:
            requestDocPath.current ?? now.current.context?.docPath ?? null,
        });
      await flushPendingWrites();
    });
    return unlistenAll(unlisten);
  }, [editorLabel, requestDocPath]);
}

/** The window kept on top while pinned, and titled after the document. */
function useChatWindowLook(
  pinned: boolean,
  docTitle: string | undefined,
  t: Strings,
) {
  useEffect(() => {
    void thisWindow().setAlwaysOnTop(pinned);
  }, [pinned]);
  useEffect(() => {
    void setWindowTitle(
      docTitle ? `${t.agentPanelTitle} - ${docTitle}` : t.agentPanelTitle,
    );
  }, [docTitle, t.agentPanelTitle]);
}

/** A reopened conversation waits until its document is on screen; restored
 *  earlier, its first save would file it under the wrong document. */
function useReopening({
  docPath,
  conversation,
  proposalDocs,
  send,
}: {
  docPath: string | null;
  conversation: ChatWindowHandoff["conversation"];
  proposalDocs: { readonly current: Map<string, string | null> };
  send: Send;
}): ReopenTarget {
  const [reopening, setReopening] = useState<ChatRestore | null>(null);
  useEffect(() => {
    if (!reopening) return;
    if (reopening.docPath !== null && reopening.docPath !== docPath) return;
    setReopening(null);
    proposalDocs.current.clear();
    conversation.restore(reopening.id, reopening.turns);
  }, [reopening, docPath, conversation, proposalDocs]);
  return {
    restore: setReopening,
    openDocument: (path) =>
      send(CHAT_TO_EDITOR.openDocument, { path } satisfies OpenDocumentMessage),
  };
}

/** Each proposal's status as the editor last told it, and how many wait. */
function useStatusCounts(statuses: ChatWindowHandoff["statuses"]) {
  const proposalStatus = useCallback(
    (callId: string): PendingStatus => statuses[callId] ?? "expired",
    [statuses],
  );
  const pendingCount = useMemo(
    () => Object.values(statuses).filter((s) => s === "pending").length,
    [statuses],
  );
  return { proposalStatus, pendingCount };
}

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
  const { send, sendScoped, sendForProposal, proposalDocs } = useSendToEditor(
    editorLabel,
    docPath,
  );
  const { refreshContext, requestDocPath } = useRefreshContext(
    send,
    editorLabel,
    contextWaiter,
  );
  useHandBackOnClose({ editorLabel, conversation, context, requestDocPath });
  useChatWindowLook(pinned, context?.docTitle, t);
  const reopenTarget = useReopening({
    docPath,
    conversation,
    proposalDocs,
    send,
  });
  const { proposalStatus, pendingCount } = useStatusCounts(statuses);
  useFilesToEditor(editorLabel);
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
