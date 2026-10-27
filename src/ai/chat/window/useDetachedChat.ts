import { useCallback, useEffect, useSyncExternalStore } from "react";
import { thisWindow } from "../../../platform/this-window";
import { windowIpc } from "../../../platform/ipc";
import { canDetachChat } from "../../../platform/capabilities";
import { listenToThisWindow, unlistenAll } from "../../../platform/events";
import { useLatest } from "../../../utils/hooks/useLatest";
import type { AgentTurn, EditProposal } from "../../types";
import type { PendingStatus } from "../../revision/usePendingEdits";
import {
  CHAT_TO_EDITOR,
  CHAT_WINDOWS_CHANGED,
  EDITOR_TO_CHAT,
  onWindowEvent,
  sendToWindow,
  type BulkDecisionMessage,
  type DocScopedMessage,
  type CallIdMessage,
  type ChatContext,
  type ChatHandoffState,
  type ProposalsMessage,
  type ReembedMessage,
  type SelectionChipMessage,
} from "./chat-bridge";
import type { SelectionChipHandlers } from "../ChatComposer";

/**
 * Which chat window this webview talks to. Module-level, not React state, so
 * every tab knows where to push its context, not just the one that detached.
 */
let sharedChatLabel: string | null = null;
const labelListeners = new Set<() => void>();

function getSharedChatLabel() {
  return sharedChatLabel;
}

function setSharedChatLabel(next: string | null) {
  if (sharedChatLabel === next) return;
  sharedChatLabel = next;
  for (const listener of labelListeners) listener();
}

function subscribeChatLabel(listener: () => void) {
  labelListeners.add(listener);
  return () => {
    labelListeners.delete(listener);
  };
}

/** Asks Rust which chat window serves this editor window: the chat may have
 *  closed, or this webview reloaded, without the local store seeing it. */
async function refreshChatLabel() {
  try {
    setSharedChatLabel(await windowIpc.currentChatWindow());
  } catch {
    // No backend (dev shim) - leave whatever the local store has.
  }
}

/**
 * Keeps the store honest once per webview, not once per tab, to avoid N
 * identical IPC round trips. Focus is a cheap backstop for missed events.
 */
let watchers = 0;
let stopWatching: (() => void) | null = null;

function watchChatWindows(): () => void {
  // No chat windows to watch where the chat cannot be detached (iOS).
  if (!canDetachChat) return () => {};
  if (watchers++ === 0) {
    const onFocus = () => void refreshChatLabel();
    window.addEventListener("focus", onFocus);
    const unlisten = unlistenAll(
      listenToThisWindow(CHAT_WINDOWS_CHANGED, () => {
        void refreshChatLabel();
      }),
    );
    stopWatching = () => {
      window.removeEventListener("focus", onFocus);
      unlisten();
    };
    void refreshChatLabel();
  }
  return () => {
    if (--watchers === 0) {
      stopWatching?.();
      stopWatching = null;
    }
  };
}

export interface DetachedChatHandlers {
  /** Whether a doc-scoped message for `docPath` is for this tab. Checked by
   *  the hook before the doc-scoped handlers fire. */
  isTarget: (docPath: string | null) => boolean;
  onProposals: (
    proposals: { callId: string; proposal: EditProposal }[],
  ) => void;
  onAccept: (callId: string) => void;
  onReject: (callId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  /** The chat window closed and handed its conversation back. */
  onReembed: (
    conversationId: string,
    turns: AgentTurn[],
    docPath: string | null,
  ) => void;
  /** The chat is about to send and wants the document as it reads NOW. */
  onContextRequest: () => void;
  /** The window's selection chip (ChatComposer's selectionChip). */
  selectionChip: SelectionChipHandlers;
}

/**
 * The editor's half of the detached-chat bridge. Every proposal is still
 * resolved and applied here, so the bridge forwards calls, not state.
 */
export function useDetachedChat(handlers: DetachedChatHandlers) {
  const chatLabel = useSyncExternalStore(
    subscribeChatLabel,
    getSharedChatLabel,
  );
  const latest = useLatest(handlers);

  useEffect(() => {
    const scoped = <T extends DocScopedMessage>(
      handle: (payload: T) => void,
    ) => {
      return (payload: T) => {
        if (latest.current.isTarget(payload.docPath)) handle(payload);
      };
    };
    return unlistenAll(
      onWindowEvent<ProposalsMessage>(
        CHAT_TO_EDITOR.proposals,
        scoped((payload) => latest.current.onProposals(payload.proposals)),
      ),
      onWindowEvent<CallIdMessage>(
        CHAT_TO_EDITOR.accept,
        scoped((payload) => latest.current.onAccept(payload.callId)),
      ),
      onWindowEvent<CallIdMessage>(
        CHAT_TO_EDITOR.reject,
        scoped((payload) => latest.current.onReject(payload.callId)),
      ),
      onWindowEvent<BulkDecisionMessage>(
        CHAT_TO_EDITOR.acceptAll,
        scoped(() => latest.current.onAcceptAll()),
      ),
      onWindowEvent<BulkDecisionMessage>(
        CHAT_TO_EDITOR.rejectAll,
        scoped(() => latest.current.onRejectAll()),
      ),
      onWindowEvent<SelectionChipMessage>(
        CHAT_TO_EDITOR.selectionChip,
        scoped((payload) =>
          latest.current.selectionChip.onChange(payload.chip),
        ),
      ),
      onWindowEvent<DocScopedMessage>(
        CHAT_TO_EDITOR.revealSelection,
        scoped(() => latest.current.selectionChip.onReveal()),
      ),
      onWindowEvent(CHAT_TO_EDITOR.requestContext, () =>
        latest.current.onContextRequest(),
      ),
      onWindowEvent<ReembedMessage>(CHAT_TO_EDITOR.reembed, (payload) => {
        setSharedChatLabel(null);
        latest.current.onReembed(
          payload.conversationId,
          payload.turns ?? [],
          payload.docPath ?? null,
        );
      }),
    );
  }, [latest]);

  useEffect(watchChatWindows, []);

  /** Pops the chat out, or reveals the one already open. Resolves once the
   *  window exists. */
  const detach = useCallback(
    async (
      state: ChatHandoffState,
      title: string,
      /** So Rust builds the window always-on-top from the start. */
      pinned: boolean,
    ) => {
      const win = thisWindow();
      let position: [number, number] | null = null;
      try {
        // Beside the editor: detaching is meant to uncover the document.
        const [pos, size, scale] = await Promise.all([
          win.outerPosition(),
          win.outerSize(),
          win.scaleFactor(),
        ]);
        position = [(pos.x + size.width) / scale + 12, pos.y / scale];
      } catch {
        // No bounds available - let the platform place it.
      }
      const label = await windowIpc.detachChatWindow({
        state,
        position,
        title,
        pinned,
      });
      setSharedChatLabel(label);
      return label;
    },
    [],
  );

  /** Pushes the current document and selection, which also re-addresses the
   *  chat to this window. */
  const pushContext = useCallback(
    (context: ChatContext) => {
      if (chatLabel) sendToWindow(chatLabel, EDITOR_TO_CHAT.context, context);
    },
    [chatLabel],
  );

  const pushStatuses = useCallback(
    (statuses: Record<string, PendingStatus>) => {
      if (chatLabel) sendToWindow(chatLabel, EDITOR_TO_CHAT.statuses, statuses);
    },
    [chatLabel],
  );

  const closeDetached = useCallback(() => {
    void windowIpc.closeChatWindow();
    setSharedChatLabel(null);
  }, []);

  return {
    /** Non-null while a detached chat window serves this editor window. */
    chatLabel,
    detach,
    pushContext,
    pushStatuses,
    closeDetached,
  };
}
