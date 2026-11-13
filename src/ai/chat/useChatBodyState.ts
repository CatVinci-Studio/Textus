import type { QueuedMessage } from "./MessageQueue";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLatest } from "../../utils/hooks/useLatest";
import type { AgentTurn } from "../types";
import { useRevealedText } from "./useRevealedText";
import {
  type ChatBodyProps,
  proposalsFromTurns,
  quickReplyExpands,
} from "./chat-body-types";

/** The chat body's state, one hook per concern. */

/** The in-flight exchange with its prose paced, while `paced`: Quick Ask's
 *  one line. The list paces its live reply itself. */
export function useRevealedStream(
  received: ChatBodyProps["conversation"]["streaming"],
  paced: boolean,
) {
  const revealedText = useRevealedText(
    received?.text ?? "",
    !!received && paced,
  );
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

/** Streamed turns become pending previews the moment they land. The pass
 *  after the send repeats them, a no-op since adds are idempotent per callId. */
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

/** Messages sent while a reply is coming, sent in turn by `sendNext` once
 *  nothing is in flight. A failed reply pauses them until Continue. */
export function useMessageQueue(
  busy: boolean,
  /** The conversation's failure: while there is one, the queue waits. */
  failure: unknown,
  sendNext: (next: QueuedMessage) => Promise<AgentTurn[] | undefined>,
) {
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  // The failure the user chose to go on past.
  const [passed, setPassed] = useState<unknown>(null);
  const queuePaused = !!failure && failure !== passed && queue.length > 0;
  // Bumped as each send ends, so the queue looks again.
  const [settled, setSettled] = useState(0);
  const nextQueued = useRef(0);
  // A send under way, queued or straight from the box: one more waits.
  const sending = useRef(false);
  // This render's; the queue and busy say when to look again.
  const send = useLatest(sendNext);

  /** Runs one send - from the box, the queue or Retry - as the one in
   *  flight. */
  const run = useCallback(async <T>(go: () => Promise<T>) => {
    sending.current = true;
    try {
      return await go();
    } finally {
      sending.current = false;
      setSettled((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    if (queue.length === 0 || busy || queuePaused || sending.current) return;
    const [next] = queue;
    setQueue((now) => now.filter((q) => q.id !== next.id));
    void run(() => send.current(next));
  }, [busy, queue, queuePaused, send, run, settled]);

  return {
    queue,
    setQueue,
    queuePaused,
    goOn: () => setPassed(failure),
    nextQueued,
    sending,
    run,
  };
}
