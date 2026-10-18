import { errorText } from "../../utils/error-text";
import { useEffect, useRef, useState } from "react";
import { keepCancelledTurns } from "./cancelled-turns";
import { conversationTitle, saveConversation } from "./chat-history";
import { annotateProposalStatuses } from "../revision/proposal-status";
import type { AgentTurn, ImageAttachment } from "../types";
import type { PendingStatus } from "../revision/usePendingEdits";
import {
  ai,
  AI_CANCELLED,
  IpcError,
  type StreamEvent,
} from "../../platform/ipc";
import { useLatest } from "../../utils/hooks/useLatest";
import { useSettings, type AgentMode } from "../../settings/SettingsContext";

export interface AgentRequestOptions {
  mode: AgentMode;
  webSearch: boolean;
  /** See ai.agentMessage's focusHeading. */
  focusHeading?: string | null;
}

/** What has streamed in so far for the in-flight exchange: completed
 *  intermediate turns (the user's own message, tool calls/results as they
 *  land) plus the assistant prose fragment currently being generated.
 *  Display-only - the resolved request's turn list is what enters
 *  `history`; this exists so the UI has something live to show first. */
export interface StreamingState {
  turns: AgentTurn[];
  text: string;
}

/** The (document, message) pair behind the last failed send - lets the
 *  caller offer a "retry" that resends without the user retyping. */
export interface RetryableSend {
  document: string;
  message: string;
  /** Resent as-is: a retry that dropped the attached images would answer a
   *  question about a picture the model can no longer see. */
  images: ImageAttachment[];
  options: AgentRequestOptions;
}

/// Multi-turn agent conversation state/logic backing the inline chat bar
/// (see ai/chat/quick-ask/InlineChat.tsx) against the `ai_agent_message` backend command -
/// pulled out on its own so any other agent surface added later can reuse
/// the same history bookkeeping instead of reimplementing it.
///
/// Lives above the chat bar itself (see MilkdownEditor) so a completed
/// exchange can be saved after the popup closes. Closing and reopening keeps
/// the current conversation; the header's explicit New Conversation action
/// calls `reset`, while `restore` resumes a saved conversation. The document
/// is passed per send, so each message can use the latest captured context.
export function useAgentConversation(
  docPath: string | null,
  /** The chosen project folder, or null for the default (the document's
   *  folder). Decides where `.textus/` is read from and how far the agent's
   *  file tools may reach - see ai/workspace.rs. */
  workspaceRoot: string | null,
  provider: string,
  webSearch: boolean,
  model: string | undefined,
  /** Raw stream events beyond what `streaming` state captures - the editor
   *  hooks propose_edit argument fragments here to grow the in-document
   *  preview while the model is still writing it. Read through a ref, so a
   *  re-render mid-request picks up the newest callback. */
  onStreamEvent?: (event: StreamEvent) => void,
  /** Per-callId status of every propose_edit proposal so far
   *  (usePendingEdits' `allStatuses`, or the copy pushed to the detached
   *  window). Annotated onto the history at send time - see
   *  proposal-status.ts - so a follow-up prompt doesn't leave the model
   *  assuming its still-undecided previous proposal is in the document. */
  proposalStatuses?: Record<string, PendingStatus>,
  /** False for Quick Ask: a one-off exchange that stays out of the History
   *  list unless it is carried over to the full conversation. */
  persist = true,
) {
  const [conversationId, setConversationId] = useState<string>(() =>
    crypto.randomUUID(),
  );
  const [history, setHistory] = useState<AgentTurn[]>([]);
  const [streaming, setStreamingState] = useState<StreamingState | null>(null);
  // Mirror of `streaming`, readable synchronously inside `send`'s catch:
  // a stop must fold what already streamed into history, and the state
  // value in that closure is stale by then.
  const streamingRef = useRef<StreamingState | null>(null);
  // Text deltas can arrive several times a frame, and each state update
  // re-renders the editor that owns this conversation - so a delta only
  // marks the state dirty, and one render per frame picks up all of them.
  // Everything else (a landed turn, the end) renders at once.
  const deltaFrame = useRef<number | null>(null);
  const setStreaming = (
    value: StreamingState | null,
    { textOnly = false } = {},
  ) => {
    streamingRef.current = value;
    if (textOnly) {
      deltaFrame.current ??= requestAnimationFrame(() => {
        deltaFrame.current = null;
        setStreamingState(streamingRef.current);
      });
      return;
    }
    if (deltaFrame.current !== null) cancelAnimationFrame(deltaFrame.current);
    deltaFrame.current = null;
    setStreamingState(value);
  };
  const [busy, setBusy] = useState(false);
  const onStreamEventRef = useLatest(onStreamEvent);
  // The agent is told the UI's names for things in this language.
  const uiLanguage = useLatest(useSettings().settings.language);
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState<RetryableSend | null>(null);
  // The in-flight request's id, for stop() to cancel by - null when nothing
  // is running.
  const requestIdRef = useRef<string | null>(null);
  // Incremented whenever a fresh popup replaces the current conversation.
  // A late response from the old popup must never leak into the new chat.
  const generationRef = useRef(0);

  // Every exchange updates the conversation's saved copy, so past chats can
  // be reopened from the History list even across restarts.
  useEffect(() => {
    if (!persist || history.length === 0) return;
    saveConversation({
      id: conversationId,
      docPath,
      title: conversationTitle(history),
      updatedAt: Date.now(),
      turns: history.map(withoutImageData),
    });
  }, [history, conversationId, docPath, persist]);

  /** Returns the newly arrived turns - the caller's hook for reacting to
   *  what came back, e.g. the chat bar turning propose_edit tool calls into
   *  in-document previews. A stop returns the partial turns it kept (so
   *  completed proposals still get their afterSend re-show); undefined means
   *  the send was skipped, failed, or was stopped before anything streamed. */
  async function send(
    document: string,
    message: string,
    /** Attached images. Text-shaped attachments (PDF, Word, spreadsheets)
     *  were extracted and inlined into `message` by the caller; images have
     *  no text to inline and travel as provider image parts instead. */
    images: ImageAttachment[] = [],
    options: AgentRequestOptions = { mode: "review", webSearch },
  ): Promise<AgentTurn[] | undefined> {
    const trimmed = message.trim();
    if (!trimmed || busy) return undefined;
    setBusy(true);
    setError(null);
    setRetryable(null);
    // The user's message shows immediately as a streamed turn - the real
    // one only enters `history` when the whole exchange resolves.
    setStreaming({
      turns: [{ kind: "User", text: trimmed, images }],
      text: "",
    });
    const requestId = crypto.randomUUID();
    const generation = generationRef.current;
    requestIdRef.current = requestId;
    try {
      const newTurns = await ai.agentMessage({
        provider,
        document,
        docPath,
        workspaceRoot,
        history: annotateProposalStatuses(history, proposalStatuses ?? {}),
        message: trimmed,
        images,
        webSearch: options.webSearch,
        mode: options.mode,
        focusHeading: options.focusHeading ?? null,
        uiLanguage: uiLanguage.current,
        model: model || null,
        requestId,
        onEvent: (event) => {
          if (generation !== generationRef.current) return;
          onStreamEventRef.current?.(event);
          if (event.type === "delta") {
            const prev = streamingRef.current;
            setStreaming(
              {
                turns: prev?.turns ?? [],
                text: (prev?.text ?? "") + event.text,
              },
              { textOnly: true },
            );
          } else if (event.type === "turn") {
            // Interim prose that streamed before a tool call is dropped,
            // mirroring how the backend's step parsers prefer tool calls
            // over accompanying text - it never enters history either.
            const prev = streamingRef.current;
            setStreaming({
              turns: [...(prev?.turns ?? []), event.turn],
              text: "",
            });
          }
        },
      });
      if (generation !== generationRef.current) return undefined;
      setHistory((prev) => [...prev, ...newTurns]);
      return newTurns;
    } catch (err) {
      if (generation !== generationRef.current) return undefined;
      // A user-initiated stop() isn't a failure - no error, and nothing to
      // retry (the message wasn't the problem). What already streamed stays:
      // the user watched that content arrive, and stopping means "that's
      // enough", not "throw it away" - so it enters history the same way a
      // completed exchange would (see cancelled-turns.ts for what's kept).
      if (err instanceof IpcError && err.cause === AI_CANCELLED) {
        const partial = streamingRef.current;
        const kept = keepCancelledTurns(
          partial?.turns ?? [],
          partial?.text ?? "",
        );
        if (kept.length === 0) return undefined;
        setHistory((prev) => [...prev, ...kept]);
        return kept;
      }
      setError(errorText(err));
      setRetryable({ document, message: trimmed, images, options });
      return undefined;
    } finally {
      if (generation === generationRef.current) {
        setBusy(false);
        setStreaming(null);
        requestIdRef.current = null;
      }
    }
  }

  /** Cancels the in-flight request, if any - a no-op otherwise. */
  function stop() {
    if (requestIdRef.current) void ai.cancelAgentMessage(requestIdRef.current);
  }

  // The editor that owns this conversation went away (tab closed, source
  // mode): nobody is left to show the reply, so stop paying for it.
  useEffect(
    () => () => {
      if (requestIdRef.current)
        void ai.cancelAgentMessage(requestIdRef.current);
    },
    [],
  );

  /** Resends the last failed message unchanged. */
  function retry(): Promise<AgentTurn[] | undefined> {
    if (!retryable) return Promise.resolve(undefined);
    return send(
      retryable.document,
      retryable.message,
      retryable.images,
      retryable.options,
    );
  }

  /** Replaces the live conversation wholesale: cancels anything in flight,
   *  fences off late responses (generation bump), and clears every piece of
   *  per-exchange state. The one teardown `reset` and `restore` share, so a
   *  new step (say, clearing a future draft field) can't land in only one
   *  of them. */
  function load(id: string, turns: AgentTurn[]) {
    generationRef.current += 1;
    if (requestIdRef.current) void ai.cancelAgentMessage(requestIdRef.current);
    requestIdRef.current = null;
    setConversationId(id);
    setHistory(turns);
    setStreaming(null);
    setBusy(false);
    setError(null);
    setRetryable(null);
  }

  // A new, empty conversation: a fresh Quick Ask from the right-click menu
  // or the shortcut, or "New conversation" in the panel or chat window.
  // Restoring from History bypasses this and loads that conversation.
  function reset() {
    load(crypto.randomUUID(), []);
  }

  /** Restores a saved (or handed-over) conversation as the live one -
   *  sending continues it. Takes the id/turns pair rather than a full
   *  ChatHistoryEntry because two of the three callers are surface hops
   *  (detach handoff, window re-embed) that have no entry - they'd have to
   *  fabricate display-only fields restore never read. */
  function restore(id: string, turns: AgentTurn[]) {
    load(id, turns);
  }

  return {
    // Exposed so a conversation can move between windows (detached chat)
    // without being re-saved under a new id each hop, which would leave one
    // exchange scattered across several sidebar history entries.
    conversationId,
    history,
    streaming,
    busy,
    error,
    retryable,
    send,
    stop,
    retry,
    reset,
    restore,
  };
}

export type AgentConversation = ReturnType<typeof useAgentConversation>;

/**
 * A turn with its image payloads dropped, keeping only what the transcript
 * displays (name and type).
 *
 * Attached images are REQUEST data: base64 inflates a file by 4/3, and chat
 * history is one JSON file (chat-history.json, see docs/dev/storage.md) that
 * Rust rewrites on every save and every window keeps a copy of. A few
 * screenshots would turn each save into megabytes of writing and IPC. (Under
 * localStorage, where history used to live, one 6 MB screenshot overflowed
 * the quota and silently stopped ALL history from saving.) A retry still has
 * the real payloads; they hang off `RetryableSend`, not off history.
 */
function withoutImageData(turn: AgentTurn): AgentTurn {
  if (turn.kind !== "User" || !turn.images?.length) return turn;
  return {
    ...turn,
    images: turn.images.map(({ name, mime }) => ({
      name,
      mime,
      dataBase64: "",
    })),
  };
}
