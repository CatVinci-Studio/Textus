import { keepCancelledTurns } from "../cancelled-turns";
import { afterFileChanges } from "../file-changes";
import { ai } from "../../../platform/ipc";
import { announce } from "../../../engine/controls/announce";
import { resolveStrings } from "../../../i18n/strings";
import type { AgentTurn } from "../../types";
import {
  cancelAgentExchange,
  endAgentSession,
} from "../../agents/agent-exchange";
import { AGENT_REQUEST } from "../../agents/agent-request";
import { conversationTitle, saveConversation } from "../chat-history";
import { conversationScope, setLiveConversation } from "../conversation-scope";
import { NextMessage } from "../next-message";
import type { StreamingState } from "../stream-step";
import { sendMessage } from "./conversation-send";
import type { DocumentPort } from "./document-port";
import type {
  AgentRequestOptions,
  ConversationActions,
  ConversationEnv,
  ConversationPlace,
  ConversationState,
} from "./conversation-types";

const NONE: string[] = [];
let made = 0;

/** The conversations with a request in flight, in this window. */
const running = new Set<ConversationModel>();

/** Stops every request as Stop would, keeping what has streamed: Textus AI
 *  was turned off. */
export function stopConversations(): void {
  for (const model of running) model.stop();
}

interface ConversationOptions {
  env: () => ConversationEnv;
  /** False for Quick Ask: a one-off exchange that stays out of the History
   *  list unless it is carried over to the full conversation. */
  persist?: boolean;
  /** A conversation History may hold; its turns come with `adopt`. */
  id?: string;
  /** Told when the model becomes another conversation. */
  onIdentity?: (model: ConversationModel) => void;
}

/**
 * One multi-turn conversation with Textus AI, held outside React so it
 * outlives whatever draws it: its turns, the reply streaming in, and the
 * request behind it. `reset` starts over, `restore` resumes a saved one.
 */
export class ConversationModel {
  /** Which model this is, whatever conversation it holds now. */
  readonly key = ++made;
  readonly persist: boolean;
  readonly env: () => ConversationEnv;
  readonly next = new NextMessage((suggestions) => this.patch({ suggestions }));
  /** The reply as received so far, readable at once: a stop folds it into
   *  the history before the state has caught up. */
  streamingNow: StreamingState | null = null;
  /** The in-flight request's id, for stop() to cancel by. */
  requestId: string | null = null;
  /** Bumped whenever a fresh conversation replaces this one, so a late
   *  response never leaks into the new chat. */
  generation = 0;
  lastOptions: AgentRequestOptions | null = null;
  /** The document the last request was sent about. */
  about: DocumentPort | null = null;
  /** The scope it is the live conversation of, once said or reopened there;
   *  null for one not yet sent. */
  scope: string | null = null;

  private state: ConversationState;
  /** The state without the reply streaming in, for readers out of sight. */
  private settled: ConversationState;
  private readonly listeners = new Set<() => void>();
  private readonly onIdentity?: (model: ConversationModel) => void;
  // Text deltas can arrive several times a frame, so a delta only marks the
  // state dirty and one change per frame picks them up.
  private deltaFrame: number | null = null;
  /** Turns as History holds them: shown, not saved again. */
  private filed: AgentTurn[] | null = null;
  /** Where it was last sent, reset or restored: where it is saved. */
  private place: ConversationPlace | null = null;

  constructor(options: ConversationOptions) {
    this.env = options.env;
    this.persist = options.persist ?? true;
    this.onIdentity = options.onIdentity;
    this.state = {
      conversationId: options.id ?? crypto.randomUUID(),
      history: [],
      thoughts: {},
      streaming: null,
      busy: false,
      error: null,
      retryable: null,
      suggestions: NONE,
    };
    this.settled = this.state;
  }

  get id(): string {
    return this.state.conversationId;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): ConversationState => this.state;

  settledSnapshot = (): ConversationState => this.settled;

  patch(change: Partial<ConversationState>) {
    this.state = { ...this.state, ...change };
    if (Object.keys(change).some((key) => key !== "streaming"))
      this.settled = { ...this.state, streaming: null };
    for (const listener of this.listeners) listener();
  }

  setStreaming(value: StreamingState | null, { textOnly = false } = {}) {
    this.streamingNow = value;
    if (textOnly) {
      this.deltaFrame ??= requestAnimationFrame(() => {
        this.deltaFrame = null;
        this.patch({ streaming: this.streamingNow });
      });
      return;
    }
    if (this.deltaFrame !== null) cancelAnimationFrame(this.deltaFrame);
    this.deltaFrame = null;
    this.patch({ streaming: value });
  }

  /** A screen reader hears that Textus AI started and finished, or why it
   *  stopped; the reply itself is read in the conversation. */
  setBusy(busy: boolean) {
    if (busy === this.state.busy) return;
    this.patch({ busy });
    if (busy) running.add(this);
    else running.delete(this);
    const t = resolveStrings(this.env().settings.language);
    announce(
      busy ? t.announceAiWriting : (this.state.error ?? t.announceAiDone),
    );
  }

  /** Every exchange updates the conversation's saved copy, so past chats
   *  can be reopened from the History list even across restarts. */
  setHistory(update: (history: AgentTurn[]) => AgentTurn[]) {
    this.patch({ history: update(this.state.history) });
    this.save();
  }

  /** Sent, reset or restored at `place`: saved there from now on, and its
   *  scope's conversation in every tab and window. A draft never saved has
   *  no scope and keeps its own. */
  publish(place: ConversationPlace = this.env()) {
    this.place = { docPath: place.docPath, workspaceRoot: place.workspaceRoot };
    if (!this.persist) return;
    const scope = conversationScope(place.docPath, place.workspaceRoot);
    if (!scope) return;
    this.scope = scope;
    setLiveConversation(scope, this.id);
  }

  /** History's turns for this conversation, unless it has moved on. */
  adopt(id: string, turns: AgentTurn[]) {
    if (id !== this.id || this.state.busy || this.state.history.length > 0)
      return;
    this.filed = turns;
    this.patch({ history: turns });
  }

  stop = () => {
    if (this.requestId?.startsWith(AGENT_REQUEST)) cancelAgentExchange(this.id);
    else if (this.requestId) void ai.cancelAgentMessage(this.requestId);
  };

  /** Nobody is left to show the reply: the request ends. What already
   *  streamed is kept, as at Stop, and files it changed are marked. */
  dispose() {
    const partial = this.state.busy ? this.streamingNow : null;
    if (partial) {
      const kept = keepCancelledTurns(partial.turns, partial.text);
      if (kept.length > 0) this.setHistory((prev) => [...prev, ...kept]);
      void afterFileChanges(
        this.id,
        partial.turns,
        this.env().settings.aiChangeMode === "revision",
      );
    }
    this.generation += 1;
    this.end();
    this.setStreaming(null);
    running.delete(this);
    this.patch({ busy: false });
  }

  reset = (place?: ConversationPlace) => {
    this.load(crypto.randomUUID(), []);
    this.publish(place);
  };

  restore = (id: string, turns: AgentTurn[], place?: ConversationPlace) => {
    this.load(id, turns);
    this.publish(place);
    this.save();
  };

  readonly actions: ConversationActions = {
    lastOptions: () => this.lastOptions,
    send: (document, message, images, options) =>
      sendMessage(this, document, message, images, options),
    stop: this.stop,
    retry: () => {
      const { retryable } = this.state;
      if (!retryable) return Promise.resolve(undefined);
      return sendMessage(
        this,
        retryable.document,
        retryable.message,
        retryable.images,
        retryable.options,
      );
    },
    reset: this.reset,
    restore: this.restore,
    append: (turns) => this.setHistory((prev) => [...prev, ...turns]),
  };

  private end() {
    endAgentSession(this.id);
    if (this.requestId) void ai.cancelAgentMessage(this.requestId);
    this.requestId = null;
  }

  /** Replaces the conversation wholesale: cancels anything in flight,
   *  fences off late responses and clears per-exchange state. Shared by
   *  `reset` and `restore` so neither misses a step. */
  private load(id: string, turns: AgentTurn[]) {
    this.generation += 1;
    this.end();
    this.filed = null;
    this.setStreaming(null);
    this.patch({
      conversationId: id,
      history: turns,
      thoughts: {},
      error: null,
      retryable: null,
    });
    this.setBusy(false);
    this.next.clear();
    this.onIdentity?.(this);
  }

  private save() {
    const { history, conversationId } = this.state;
    if (!this.persist || history.length === 0 || history === this.filed) return;
    saveConversation({
      id: conversationId,
      docPath: (this.place ?? this.env()).docPath,
      title: conversationTitle(history),
      updatedAt: Date.now(),
      turns: history.map(withoutImageData),
    });
  }
}

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
