import type { AgentRequestOptions } from "./useAgentConversation";
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
}

export interface MessageQueueLabels {
  /** Over the list: "{n}" waiting, sent after the reply. */
  queued: string;
  /** Instead, after a reply that failed: they wait for Continue. */
  queuedPaused: string;
  queueContinue: string;
  queueEdit: string;
  queueRemove: string;
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
  onContinue,
}: {
  queue: QueuedMessage[];
  paused: boolean;
  labels: MessageQueueLabels;
  onEdit: (id: number) => void;
  onRemove: (id: number) => void;
  onContinue: () => void;
}) {
  if (queue.length === 0) return null;
  return (
    <div className="chat-queue" role="list" aria-label={labels.queued}>
      <div className="chat-queue-title">
        <span>
          {(paused ? labels.queuedPaused : labels.queued).replace(
            "{n}",
            String(queue.length),
          )}
        </span>
        {paused && (
          <button
            type="button"
            className="inline-chat-action"
            onClick={onContinue}
          >
            {labels.queueContinue}
          </button>
        )}
      </div>
      {queue.map((item) => (
        <div key={item.id} className="chat-queue-item" role="listitem">
          <span className="chat-queue-text">{item.typed}</span>
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
