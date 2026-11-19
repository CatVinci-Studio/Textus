import { fill } from "../../i18n/fill";
import type { AgentRequestOptions } from "./conversation/conversation-types";
import type { ImageAttachment } from "../types";

/** A message sent while a reply was still coming; it goes once the replies
 *  before it finish. Its selection and attachments are as sent, but the
 *  document is read when it goes. */
export interface QueuedMessage {
  id: number;
  /** What the user typed, for Edit to put back. */
  typed: string;
  message: string;
  images?: ImageAttachment[];
  options: AgentRequestOptions;
  /** Sent into the reply in progress, which reads it at its next step:
   *  it leaves the list once read, or goes after the reply if it wasn't. */
  inserted?: boolean;
}

export interface MessageQueueLabels {
  /** Over the list: "{n}" waiting, sent after the reply. */
  queued: string;
  /** Instead, after a reply that failed: they wait for Continue. */
  queuedPaused: string;
  queueContinue: string;
  queueEdit: string;
  queueRemove: string;
  /** Into the reply in progress now, not after it. */
  queueInsert: string;
}

/**
 * The messages waiting for the reply in progress, over the composer, each
 * with Edit (back into the composer) and Remove.
 */
export function MessageQueue({
  queue,
  paused,
  labels,
  onEdit,
  onRemove,
  onInsert,
  onContinue,
}: {
  queue: QueuedMessage[];
  paused: boolean;
  labels: MessageQueueLabels;
  onEdit: (id: number) => void;
  onRemove: (id: number) => void;
  onInsert: (id: number) => void;
  onContinue: () => void;
}) {
  if (queue.length === 0) return null;
  return (
    <div
      className="chat-queue"
      role="list"
      aria-label={fill(labels.queued, { n: String(queue.length) })}
    >
      <div className="chat-queue-title">
        <span>
          {fill(paused ? labels.queuedPaused : labels.queued, {
            n: String(queue.length),
          })}
        </span>
        {paused && (
          <button
            type="button"
            className="tx-button small inline-chat-action"
            onClick={onContinue}
          >
            {labels.queueContinue}
          </button>
        )}
      </div>
      {queue.map((item) => (
        <div key={item.id} className="chat-queue-item" role="listitem">
          <span className="tx-truncate chat-queue-text">{item.typed}</span>
          {!paused && !item.inserted && (
            <button
              type="button"
              className="chat-queue-action"
              aria-label={`${labels.queueInsert}: ${item.typed}`}
              onClick={() => onInsert(item.id)}
            >
              {labels.queueInsert}
            </button>
          )}
          <button
            type="button"
            className="chat-queue-action"
            aria-label={`${labels.queueEdit}: ${item.typed}`}
            onClick={() => onEdit(item.id)}
          >
            {labels.queueEdit}
          </button>
          <button
            type="button"
            className="chat-queue-action"
            aria-label={`${labels.queueRemove}: ${item.typed}`}
            onClick={() => onRemove(item.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
