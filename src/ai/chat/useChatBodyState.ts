import type { QueuedMessage } from "./MessageQueue";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLatest } from "../../utils/hooks/useLatest";
import type { AgentTurn } from "../types";
import { useRevealedText } from "./useRevealedText";
import {
  type ChatBodyProps,
  proposalsFromTurns,
  quickReplyExpands,
} from "./chat-body-types";

/**
 * The chat body's state, a concern each (ChatBody.tsx): the reply as it
 * is drawn, Quick Ask's answer shown whole or not, the proposals a
 * streaming reply brings, and the messages queued behind it.
 */

/** The in-flight exchange as drawn: its prose paced onto the screen
 *  (useRevealedText). The conversation keeps the text as received. */
export function useRevealedStream(
  received: ChatBodyProps["conversation"]["streaming"],
) {
  const revealedText = useRevealedText(received?.text ?? "", !!received);
  return useMemo(
    () => received && { ...received, text: revealedText },
    [received, revealedText],
  );
}

/** Whether Quick Ask's answer shows whole. Collapsing by hand is a choice
 *  for the rest of this conversation: later answers in it arrive compact
 *  too. A new or restored conversation starts over. */
export function useQuickExpanded(
  variant: ChatBodyProps["variant"],
  busy: boolean,
  history: AgentTurn[],
  conversationId: ChatBodyProps["conversation"]["conversationId"],
) {
  const [quickExpanded, setQuickExpanded] = useState(
    () => variant === "quick" && quickReplyExpands(history),
  );
  const collapsedByUser = useRef(false);
  const shownConversation = useRef(conversationId);
  const awaitingReply = useRef(false);
  useEffect(() => {
    if (variant !== "quick") return;
    if (shownConversation.current !== conversationId) {
      shownConversation.current = conversationId;
      collapsedByUser.current = false;
      setQuickExpanded(quickReplyExpands(history));
      return;
    }
    if (busy) {
      awaitingReply.current = true;
      return;
    }
    if (!awaitingReply.current) return;
    awaitingReply.current = false;
    if (!collapsedByUser.current) setQuickExpanded(quickReplyExpands(history));
  }, [variant, busy, history, conversationId]);

  function toggleQuickExpanded() {
    collapsedByUser.current = quickExpanded;
    setQuickExpanded(!quickExpanded);
  }
  return { quickExpanded, toggleQuickExpanded };
}

/** Streamed turns become pending previews the moment they land, not when
 *  the whole exchange resolves - a propose_edit shows up in the document
 *  while the agent loop is still running. afterSend re-extracts the same
 *  proposals afterwards; showPreviews adds are idempotent per callId, so
 *  the second pass is a no-op for anything already shown here. */
export function useStreamedProposals(
  streaming: { turns: AgentTurn[] } | null | undefined,
  onProposals: ChatBodyProps["onProposals"],
) {
  const streamedTurnCount = useRef(0);
  const turns = streaming?.turns;
  const handler = useLatest(onProposals);
  useEffect(() => {
    if (!turns) {
      streamedTurnCount.current = 0;
      return;
    }
    const fresh = turns.slice(streamedTurnCount.current);
    streamedTurnCount.current = turns.length;
    const proposals = proposalsFromTurns(fresh);
    if (proposals.length > 0) handler.current(proposals);
  }, [turns, handler]);
}

/** Messages sent while a reply is coming (MessageQueue), sent in turn by
 *  `sendNext` once nothing is in flight. A failed reply (no turns) pauses
 *  them until Continue. */
export function useMessageQueue(
  busy: boolean,
  sendNext: (next: QueuedMessage) => Promise<AgentTurn[] | undefined>,
) {
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [queuePaused, setQueuePaused] = useState(false);
  const nextQueued = useRef(0);
  const sendingQueued = useRef(false);
  // This render's; the queue and busy say when to look again.
  const send = useLatest(sendNext);

  useEffect(() => {
    if (busy || queuePaused || sendingQueued.current || queue.length === 0)
      return;
    const [next] = queue;
    sendingQueued.current = true;
    void (async () => {
      setQueue((now) => now.filter((q) => q.id !== next.id));
      try {
        const turns = await send.current(next);
        if (!turns) setQueuePaused(true);
      } finally {
        sendingQueued.current = false;
      }
    })();
  }, [busy, queue, queuePaused, send]);

  return {
    queue,
    setQueue,
    queuePaused,
    setQueuePaused,
    nextQueued,
    sendingQueued,
  };
}
