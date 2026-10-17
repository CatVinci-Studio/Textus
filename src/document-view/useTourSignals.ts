import { useEffect, useRef } from "react";
import type { AgentConversation } from "../ai/chat/useAgentConversation";
import { sendTourSignal, type TourAi } from "../utils/events";

/**
 * What the tour's AI lessons wait for, as this editor sees it happen: a
 * grammar card opening, a revision decided, a review note pinned, an
 * answer arriving. Only the tour's practice tab reports (`tour` set), so
 * work in another document never ticks a lesson off. The completion
 * suggestion taken and a skill sent are reported where they happen
 * (editor-plugins.ts, ChatComposer).
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

  // Decided means all of it: the review bar takes a revision a sentence at
  // a time, and the lesson is about deciding, whichever way.
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
  useEffect(() => {
    const now = conversations.map((c) => c.busy);
    const answered = conversations.some(
      (c, i) => wasBusy.current[i] && !c.busy && !c.error,
    );
    wasBusy.current = now;
    if (tour && answered) sendTourSignal("reply");
    // `busy`/`failed` stand for the conversations' states.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour, busy, failed]);
}
