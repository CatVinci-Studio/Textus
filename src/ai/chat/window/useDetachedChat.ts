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
 * Which chat window this WEBVIEW is talking to.
 *
 * Module-level rather than React state because every tab in a window is a
 * separate mounted MilkdownEditor in one JS realm, and they must agree: the
 * chat window is shared across files, so a tab that never detached anything
 * itself still has to know where to push its context when it becomes the
 * active one. Per-tab state left every tab but the one that clicked "detach"
 * believing no chat was open, which is why only that one file's document ever
 * reached the window.
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

/** Asks Rust which chat window serves this editor window. Covers what a
 *  local store cannot: the chat may have been closed from its own window,
 *  or this webview reloaded, so it never saw the change happen. */
async function refreshChatLabel() {
  try {
    setSharedChatLabel(await windowIpc.currentChatWindow());
  } catch {
    // No backend (dev shim) - leave whatever the local store has.
  }
}

/**
 * Keeps the store honest, once per WEBVIEW rather than once per tab.
 *
 * Every open tab mounts its own `useDetachedChat`, so subscribing from the
 * hook meant N identical IPC round trips (each taking Rust's registry mutex)
 * every time the window was focused, N-1 of them resolving to the value the
 * store already had. This registers on the first subscriber and tears down
 * with the last.
 *
 * Rust announces registry changes (CHAT_WINDOWS_CHANGED) because it is the
 * only party that knows about them - a chat window closed from another editor
 * window is invisible here, and pushing context at a destroyed label fails
 * silently. Window focus is kept as a cheap backstop for anything the event
 * misses.
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
  /** Whether a doc-scoped message addressed to `docPath` is for THIS tab.
   *  Applied by the hook itself before any of the five handlers below fires
   *  (see the file comment on chat-bridge.ts's DocScopedMessage) - the
   *  doc-scoping contract is enforced once at the boundary instead of
   *  relying on every handler remembering to check. */
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
 * The editor's half of the detached-chat bridge.
 *
 * Authority stays here: the chat window renders a conversation and asks for
 * things, but every proposal is still resolved and applied by this window's
 * usePendingEdits. That is the whole reason the bridge forwards calls rather
 * than shipping state - a second copy of the anchor/apply logic living in
 * another window is exactly the kind of drift the 0.7.2 rework removed.
 */
export function useDetachedChat(handlers: DetachedChatHandlers) {
  const chatLabel = useSyncExternalStore(
    subscribeChatLabel,
    getSharedChatLabel,
  );
  // Handlers change identity every render; the listeners are registered once,
  // so they read through a ref rather than re-subscribing constantly.
  const latest = useLatest(handlers);

  useEffect(() => {
    /** Dispatch for the five doc-scoped messages: the isTarget check runs
     *  here, once, so no individual handler can forget it. */
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
      /** The live setting at this instant, for Rust to build the window
       *  always-on-top from the start (the window then reads it itself). */
      pinned: boolean,
    ) => {
      const win = thisWindow();
      let position: [number, number] | null = null;
      try {
        // Open beside the editor rather than on top of it - the reason to
        // detach is to stop the chat covering the document.
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

  /** Pushes the document and selection as they now read, so the chat shows
   *  the file the user is actually in and a send never goes out against a
   *  stale snapshot. Also re-addresses the chat to this window (the context
   *  carries `editorLabel`). */
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
