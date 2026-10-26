import { useEffect, useRef } from "react";
import { useLatest } from "../utils/hooks/useLatest";
import type { AgentConversation } from "../ai/chat/useAgentConversation";
import { sendTourSignal, type TourAi } from "../utils/events";

/**
 * What the tour's AI lessons wait for, as this editor sees it. Only the
 * practice tab reports, so other documents never tick a lesson off.
 */
export function useTourSignals({
  tour,
  grammarCardOpen,
  undecidedRevisions,
  reviewNotes,
  conversations,
}: {
  tour: TourAi | null;
  grammarCardOpen: boolean;
  /** Revision sentences still waiting for a decision. */
  undecidedRevisions: number;
  reviewNotes: number;
  conversations: AgentConversation[];
}) {
  useEffect(() => {
    if (tour && grammarCardOpen) sendTourSignal("grammar-card");
  }, [tour, grammarCardOpen]);

  // Decided means all of it: the review bar takes a sentence at a time.
  const hadRevisions = useRef(false);
  useEffect(() => {
    if (undecidedRevisions > 0) hadRevisions.current = true;
    else if (hadRevisions.current) {
      hadRevisions.current = false;
      if (tour) sendTourSignal("revision-decided");
    }
  }, [tour, undecidedRevisions]);

  useEffect(() => {
    if (tour && reviewNotes > 0) sendTourSignal("review-note");
  }, [tour, reviewNotes]);

  // An exchange ending (busy falling) without an error is an answer.
  const busy = conversations.map((c) => c.busy).join();
  const failed = conversations.map((c) => !!c.error).join();
  const wasBusy = useRef<boolean[]>([]);
  // `busy`/`failed` stand for the conversations' states.
  const latest = useLatest(conversations);
  useEffect(() => {
    const conversations = latest.current;
    const now = conversations.map((c) => c.busy);
    const answered = conversations.some(
      (c, i) => wasBusy.current[i] && !c.busy && !c.error,
    );
    wasBusy.current = now;
    if (tour && answered) sendTourSignal("reply");
  }, [tour, busy, failed, latest]);

  const onSkillUsed = tour ? () => sendTourSignal("skill-sent") : undefined;
  return { onSkillUsed };
}
