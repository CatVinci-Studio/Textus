import { useCallback } from "react";
import { useLatest } from "../utils/hooks/useLatest";
import { hasFormatting } from "./tutorial-evaluation";
import type { Tutorial } from "./useTutorial";

/**
 * Moves the editor step on once the learner has typed some Markdown in the
 * practice tab. Stable for Milkdown's once-registered listener; a ref keeps
 * the tour current.
 */
export function useTutorialDocumentEvaluation(tutorial: Tutorial) {
  const tutorialRef = useLatest(tutorial);
  return useCallback(
    (tabId: string, markdown: string) => {
      const current = tutorialRef.current;
      if (!current.active || tabId !== current.tabId) return;
      if (current.step.until === "formatted" && hasFormatting(markdown))
        current.next();
    },
    [tutorialRef],
  );
}
