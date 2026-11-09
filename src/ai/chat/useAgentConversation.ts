import { errorText } from "../../utils/error-text";
import { useEffect, useRef, useState } from "react";
import { keepCancelledTurns } from "./cancelled-turns";
import {
  conversationTitle,
  loadConversationTurns,
  saveConversation,
} from "./chat-history";
import {
  liveConversation,
  onLiveConversation,
  setLiveConversation,
} from "./conversation-scope";
import { annotateProposalStatuses } from "../revision/proposal-status";
import type { AgentTurn, ImageAttachment, ThinkingLevel } from "../types";
import { thinkingDone, type Thought } from "./thought";
import { streamStep, type StreamingState } from "./stream-step";
import type { PendingStatus } from "../revision/usePendingEdits";
import {
  ai,
  AI_CANCELLED,
  IpcError,
  type StreamEvent,
} from "../../platform/ipc";
import { useLatest } from "../../utils/hooks/useLatest";
import { announce } from "../../ui/announce";
import { useSettings, type AgentMode } from "../../prefs/SettingsContext";
import { imageModelOf } from "../image-models";
import type { DocumentSnapshot } from "../doc-markdown";
import {
  insertTurns,
  memoryTurns,
  passExchange,
  skillOfferTurns,
} from "./memory-pass";
import { useNextMessage } from "./next-message";
import { reportAiState } from "../../plugins/ai-state";
import { externalAgent } from "../../plugins/contributions/agents";
import { withoutAgentSteps } from "../agents/agent-view";
import {
  AGENT_REQUEST,
  agentFolder,
  agentRequest,
} from "../agents/agent-request";
import { cancelAgentExchange, endAgentSession } from "../agents/agent-exchange";

export interface AgentRequestOptions {
  mode: AgentMode;
  webSearch: boolean;
  /** Left out: the provider's default (Auto). */
  thinking?: ThinkingLevel;
  focusHeading?: string | null;
}

/** The (document, message) pair behind the last failed send, for a retry
 *  without retyping. */
export interface RetryableSend {
  document: DocumentSnapshot;
  message: string;
  /** Resent as-is: a retry that dropped the attached images would answer a
   *  question about a picture the model can no longer see. */
  images: ImageAttachment[];
  options: AgentRequestOptions;
}

/// Multi-turn agent conversation state behind the chat surfaces. Lives above
/// the chat bar so an exchange can be saved after it closes; `reset` starts
/// over, `restore` resumes a saved conversation.
export function useAgentConversation(
  docPath: string | null,
  /** The chosen project folder, or null for the document's folder. Decides
   *  where `.textus/` is read from and how far file tools may reach. */
  workspaceRoot: string | null,
  provider: string,
  webSearch: boolean,
  model: string | undefined,
  /** Raw stream events beyond `streaming`, e.g. propose_edit fragments that
   *  grow the in-document preview. Read through a ref. */
  onStreamEvent?: (event: StreamEvent) => void,
  /** Per-callId status of every proposal so far, annotated onto the history
   *  at send so the model doesn't assume an undecided proposal was applied. */
  proposalStatuses?: Record<string, PendingStatus>,
  /** False for Quick Ask: a one-off exchange that stays out of the History
   *  list unless it is carried over to the full conversation. */
  persist = true,
) {
  const [conversationId, setConversationId] = useState<string>(() =>
    crypto.randomUUID(),
  );
  const [history, setHistory] = useState<AgentTurn[]>([]);
  // Each finished exchange's thinking, by the index of its user turn in
  // `history`. Session only, not saved.
  const [thoughts, setThoughts] = useState<Record<number, Thought>>({});
  const [streaming, setStreamingState] = useState<StreamingState | null>(null);
  // Mirror of `streaming`, readable synchronously inside `send`'s catch:
  // a stop must fold what already streamed into history, and the state
  // value in that closure is stale by then.
  const streamingRef = useRef<StreamingState | null>(null);
  // Text deltas can arrive several times a frame, so a delta only marks the
  // state dirty and one render per frame picks them up. Everything else
  // renders at once.
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
  const { settings, t } = useSettings();
  // The agent is told the UI's names for things in this language.
  const uiLanguage = useLatest(settings.language);
  // generate_image is offered only with an image model.
  const imageModel = useLatest(imageModelOf(settings));
  const prefs = useLatest({
    searchService: settings.searchService,
    searxngUrl: settings.searxngUrl,
    askBeforeFileChanges: settings.agentAskBeforeFileChanges,
  });
  const [error, setError] = useState<string | null>(null);
  // A screen reader hears that Textus AI started and finished, or why it
  // stopped; the reply itself is read in the conversation.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (busy) announce(t.announceAiWriting);
    else if (wasBusy.current) announce(error ?? t.announceAiDone);
    wasBusy.current = busy;
  }, [busy, error, t]);
  const [retryable, setRetryable] = useState<RetryableSend | null>(null);
  // The in-flight request's id, for stop() to cancel by - null when nothing
  // is running.
  const requestIdRef = useRef<string | null>(null);
  // Bumped whenever a fresh conversation replaces this one, so a late
  // response never leaks into the new chat.
  const generationRef = useRef(0);
  /** How the last message was sent - Continue, after an exchange ran out
   *  of steps, sends the same way. */
  const lastOptionsRef = useRef<AgentRequestOptions | null>(null);
  const next = useNextMessage(
    provider,
    model ?? "",
    settings.suggestNextMessage && settings.textusAi,
  );

  // The conversation belongs to the folder, or to a file opened on its own:
  // every tab and window there shows the same one. A draft keeps its own
  // until it is saved.
  const scope = persist && docPath ? (workspaceRoot ?? docPath) : null;
  const idNow = useLatest(conversationId);
  const busyNow = useLatest(busy);
  // Turns taken over from another tab or window: shown, not saved again
  // under this document.
  const adopted = useRef<AgentTurn[] | null>(null);
  const loadNow = useLatest(load);
  useEffect(() => {
    if (!scope) return;
    let live = true;
    const adopt = (id: string) => {
      if (id === idNow.current || busyNow.current) return;
      void loadConversationTurns(id)
        .catch(() => null)
        .then((turns) => {
          if (!live || id === idNow.current || busyNow.current) return;
          adopted.current = turns ?? [];
          loadNow.current(id, adopted.current);
        });
    };
    const current = liveConversation(scope);
    if (current) adopt(current);
    const stopListening = onLiveConversation((changed, id) => {
      if (changed === scope) adopt(id);
    });
    return () => {
      live = false;
      stopListening();
    };
  }, [scope, idNow, busyNow, loadNow]);
  const publish = (id: string) => {
    if (scope) setLiveConversation(scope, id);
  };

  // Every exchange updates the conversation's saved copy, so past chats can
  // be reopened from the History list even across restarts.
  useEffect(() => {
    if (!persist || history.length === 0 || history === adopted.current) return;
    saveConversation({
      id: conversationId,
      docPath,
      title: conversationTitle(history),
      updatedAt: Date.now(),
      turns: history.map(withoutImageData),
    });
  }, [history, conversationId, docPath, persist]);

  /** Returns the newly arrived turns, e.g. for turning propose_edit calls
   *  into previews. A stop returns the partial turns it kept; undefined
   *  means skipped, failed, or stopped before anything streamed. */
  async function send(
    document: DocumentSnapshot,
    message: string,
    /** Attached images, sent as provider image parts. Text attachments are
     *  already inlined in `message`. */
    images: ImageAttachment[] = [],
    options: AgentRequestOptions = { mode: "review", webSearch },
  ): Promise<AgentTurn[] | undefined> {
    const trimmed = message.trim();
    if (!trimmed || busy || !settings.textusAi) return undefined;
    lastOptionsRef.current = options;
    // What is said here is the folder's conversation from now on.
    publish(conversationId);
    next.clear();
    setBusy(true);
    setError(null);
    setRetryable(null);
    // The user's message shows immediately as a streamed turn - the real
    // one only enters `history` when the whole exchange resolves.
    setStreaming({
      turns: [{ kind: "User", text: trimmed, images }],
      text: "",
      thought: null,
    });
    // Where this exchange's user turn lands in `history`.
    const at = history.length;
    const keepThought = () => {
      const thought = thinkingDone(
        streamingRef.current?.thought ?? null,
        Date.now(),
      );
      if (thought) setThoughts((prev) => ({ ...prev, [at]: thought }));
    };
    // An external agent answers the chat, not a model; never in Create or
    // Quick Ask.
    const agent =
      persist && options.mode !== "create"
        ? externalAgent(settings.chatAgent)
        : undefined;
    const folder = agent ? agentFolder(workspaceRoot, docPath) : null;
    const requestId = (agent ? AGENT_REQUEST : "") + crypto.randomUUID();
    const generation = generationRef.current;
    reportAiState("thinking", provider, model || null);
    let ended: "done" | "failed" | "stopped" = "stopped";
    requestIdRef.current = requestId;
    // add_comment arguments streaming in, by call id.
    const commentArgs = new Map<string, string>();
    try {
      if (agent && !folder) throw new Error(t.agentNeedsFolder);
      const newTurns = agent
        ? await agentRequest({
            agent,
            conversation: conversationId,
            folder: folder!,
            docPath,
            message: trimmed,
            get: () => streamingRef.current,
            set: (value, opts) => {
              if (generation === generationRef.current)
                setStreaming(value, opts);
            },
          })
        : await ai.agentMessage({
            provider,
            blocks: document.blocks,
            docPath,
            workspaceRoot,
            conversation: conversationId,
            history: annotateProposalStatuses(
              withoutAgentSteps(history),
              proposalStatuses ?? {},
            ),
            message: trimmed,
            images,
            webSearch: options.webSearch,
            thinking: options.thinking,
            ...prefs.current,
            mode: options.mode,
            focusHeading: options.focusHeading ?? null,
            uiLanguage: uiLanguage.current,
            model: model || null,
            imageModel: imageModel.current,
            requestId,
            onEvent: (event) => {
              if (generation !== generationRef.current) return;
              onStreamEventRef.current?.(event);
              const step = streamStep(
                streamingRef.current,
                event,
                document.blocks,
                commentArgs,
                Date.now(),
              );
              if (!step) return;
              if (step.phase)
                reportAiState(step.phase, provider, model || null);
              setStreaming(step.next, { textOnly: step.textOnly });
            },
          });
      if (generation !== generationRef.current) return undefined;
      keepThought();
      setHistory((prev) => [...prev, ...newTurns]);
      // What follows asks Textus AI's model, which an agent's chat doesn't use.
      if (!agent) {
        void rememberAfter([...history, ...newTurns], at + newTurns.length);
        void offerSkillAfter([...history, ...newTurns], at + newTurns.length);
        next.suggestAfter([...history, ...newTurns]);
      }
      ended = "done";
      return newTurns;
    } catch (err) {
      if (generation !== generationRef.current) return undefined;
      // A user-initiated stop() isn't a failure: no error, nothing to retry.
      // What already streamed enters history as a completed exchange would.
      if (err instanceof IpcError && err.cause === AI_CANCELLED) {
        const partial = streamingRef.current;
        const kept = keepCancelledTurns(
          partial?.turns ?? [],
          partial?.text ?? "",
        );
        if (kept.length === 0) return undefined;
        keepThought();
        setHistory((prev) => [...prev, ...kept]);
        return kept;
      }
      ended = "failed";
      setError(errorText(err));
      setRetryable({ document, message: trimmed, images, options });
      return undefined;
    } finally {
      reportAiState("idle", provider, model || null, ended);
      if (generation === generationRef.current) {
        setBusy(false);
        setStreaming(null);
        requestIdRef.current = null;
      }
    }
  }

  /** After an exchange, what is remembered is brought up to date, each
   *  change a chip right after the exchange (`at`). A failure is silent. */
  async function rememberAfter(conversation: AgentTurn[], at: number) {
    if (!settings.rememberAutomatically) return;
    const generation = generationRef.current;
    try {
      const changes = await ai.memoryPass({
        provider,
        model: model || null,
        docPath,
        workspaceRoot,
        conversation: {
          id: conversationId,
          title: conversationTitle(conversation),
        },
        exchange: passExchange(conversation),
      });
      if (changes.length === 0 || generation !== generationRef.current) return;
      const turns = memoryTurns(changes, () => crypto.randomUUID());
      setHistory((prev) => insertTurns(prev, at, turns));
    } catch {
      // Nothing remembered; the exchange itself is unaffected.
    }
  }

  /** After an exchange, its request offered as a skill when it was a
   *  procedure worth keeping, under the reply. */
  async function offerSkillAfter(conversation: AgentTurn[], at: number) {
    const generation = generationRef.current;
    try {
      const offer = await ai.offerSkill({
        provider,
        model: model || null,
        docPath,
        workspaceRoot,
        exchange: passExchange(conversation),
      });
      if (!offer || generation !== generationRef.current) return;
      const turns = skillOfferTurns(offer, () => crypto.randomUUID());
      setHistory((prev) => insertTurns(prev, at, turns));
    } catch {
      // No offer; the exchange itself is unaffected.
    }
  }

  /** Cancels the in-flight request, if any - a no-op otherwise. */
  function stop() {
    if (requestIdRef.current?.startsWith(AGENT_REQUEST))
      cancelAgentExchange(conversationId);
    else if (requestIdRef.current)
      void ai.cancelAgentMessage(requestIdRef.current);
  }

  // Textus AI was turned off - here, in Settings or in another window: a
  // request still running stops, as Stop would stop it, keeping what has
  // streamed so far.
  const aiOn = settings.textusAi;
  const conversationRef = useLatest(conversationId);
  useEffect(() => {
    const running = requestIdRef.current;
    if (aiOn || !running) return;
    if (running.startsWith(AGENT_REQUEST))
      cancelAgentExchange(conversationRef.current);
    else void ai.cancelAgentMessage(running);
  }, [aiOn, conversationRef]);

  // The editor that owns this conversation went away (tab closed, source
  // mode): nobody is left to show the reply, so stop paying for it.
  useEffect(
    () => () => {
      endAgentSession(conversationRef.current);
      if (requestIdRef.current)
        void ai.cancelAgentMessage(requestIdRef.current);
    },
    [conversationRef],
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
   *  fences off late responses and clears per-exchange state. Shared by
   *  `reset` and `restore` so neither misses a step. */
  function load(id: string, turns: AgentTurn[]) {
    generationRef.current += 1;
    endAgentSession(conversationId);
    if (requestIdRef.current) void ai.cancelAgentMessage(requestIdRef.current);
    requestIdRef.current = null;
    setConversationId(id);
    setHistory(turns);
    setThoughts({});
    setStreaming(null);
    setBusy(false);
    setError(null);
    setRetryable(null);
    next.clear();
  }

  // A new, empty conversation, for the whole folder.
  function reset() {
    const id = crypto.randomUUID();
    load(id, []);
    publish(id);
  }

  /** Restores a saved (or handed-over) conversation as the live one. Takes
   *  id/turns, not an entry: the window hops that call it have no entry. */
  function restore(id: string, turns: AgentTurn[]) {
    load(id, turns);
    publish(id);
  }

  return {
    // Exposed so a conversation can move between windows without being
    // re-saved under a new id each hop.
    conversationId,
    history,
    thoughts,
    streaming,
    busy,
    error,
    retryable,
    lastOptions: () => lastOptionsRef.current,
    /** What the writer will probably say next, most likely first. */
    suggestions: next.suggestions,
    send,
    stop,
    retry,
    reset,
    restore,
    /** Adds turns made outside a request (a paper's card and proposal) to
     *  the end of the history; a request in flight is left alone. */
    append: (turns: AgentTurn[]) => setHistory((prev) => [...prev, ...turns]),
  };
}

export type AgentConversation = ReturnType<typeof useAgentConversation>;

/**
 * A turn with its image payloads dropped, keeping name and type. Base64
 * images would make every save of the conversation file megabytes; a retry
 * still has the real payloads on `RetryableSend`.
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
