import { useEffect, useRef } from "react";
import { sendTourSignal, type TourAi } from "../utils/events";

/**
 * What the tour's AI writing lesson waits for, as this editor sees it: the
 * new text all decided. Only the practice tab reports, so other documents
 * never tick a lesson off.
 */
export function useTourSignals({
  tour,
  undecidedRevisions,
}: {
  tour: TourAi | null;
  /** Revision sentences still waiting for a decision. */
  undecidedRevisions: number;
}) {
  // Decided means all of it: the review bar takes a sentence at a time.
  const hadRevisions = useRef(false);
  useEffect(() => {
    if (undecidedRevisions > 0) hadRevisions.current = true;
    else if (hadRevisions.current) {
      hadRevisions.current = false;
      if (tour) sendTourSignal("revision-decided");
    }
  }, [tour, undecidedRevisions]);
}
