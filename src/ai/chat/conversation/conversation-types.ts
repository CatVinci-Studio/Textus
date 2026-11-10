import type { AgentMode, Settings } from "../../../prefs/SettingsContext";
import type { DocumentSnapshot } from "../../doc-markdown";
import type { AgentTurn, ImageAttachment, ThinkingLevel } from "../../types";
import type { StreamingState } from "../stream-step";
import type { Thought } from "../thought";
import type { DocumentPort } from "./document-port";

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

/** Where a conversation is held: the document it is about, and the chosen
 *  project folder (null for the document's own). Decides where `.textus/`
 *  is read from, how far file tools reach, and its scope. */
export interface ConversationPlace {
  docPath: string | null;
  workspaceRoot: string | null;
}

/** What a conversation reads of its surroundings, each time it needs them. */
export interface ConversationEnv extends ConversationPlace {
  settings: Settings;
  /** The document a request is about; null with none open. */
  port: DocumentPort | null;
}

/** What a conversation shows: one object per change. */
export interface ConversationState {
  /** Exposed so a conversation can move between windows without being
   *  re-saved under a new id each hop. */
  conversationId: string;
  history: AgentTurn[];
  /** Each finished exchange's thinking, by the index of its user turn in
   *  `history`. Session only, not saved. */
  thoughts: Record<number, Thought>;
  streaming: StreamingState | null;
  busy: boolean;
  error: string | null;
  retryable: RetryableSend | null;
  /** What the writer will probably say next, most likely first. */
  suggestions: string[];
}

export interface ConversationActions {
  /** How the last message was sent - Continue, after an exchange ran out
   *  of steps, sends the same way. */
  lastOptions: () => AgentRequestOptions | null;
  /** Returns the newly arrived turns, e.g. for turning propose_edit calls
   *  into previews. A stop returns the partial turns it kept; undefined
   *  means skipped, failed, or stopped before anything streamed. */
  send: (
    document: DocumentSnapshot,
    message: string,
    /** Attached images, sent as provider image parts. Text attachments are
     *  already inlined in `message`. */
    images?: ImageAttachment[],
    options?: AgentRequestOptions,
  ) => Promise<AgentTurn[] | undefined>;
  /** Cancels the in-flight request, if any - a no-op otherwise. */
  stop: () => void;
  /** Resends the last failed message unchanged. */
  retry: () => Promise<AgentTurn[] | undefined>;
  /** A new, empty conversation, for the whole folder: `place`'s, or else
   *  where the conversation is. */
  reset: (place?: ConversationPlace) => void;
  /** Restores a saved (or handed-over) conversation as the live one. Takes
   *  id/turns, not an entry: the window hops that call it have no entry. */
  restore: (id: string, turns: AgentTurn[], place?: ConversationPlace) => void;
  /** Adds turns made outside a request (a paper's card and proposal) to
   *  the end of the history; a request in flight is left alone. */
  append: (turns: AgentTurn[]) => void;
}

/** A conversation as the chat surfaces read and drive it. */
export type AgentConversation = ConversationState & ConversationActions;
