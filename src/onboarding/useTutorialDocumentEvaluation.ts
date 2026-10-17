import { useCallback } from "react";
import { useLatest } from "../utils/hooks/useLatest";
import { evaluateWysiwyg, hasBlock } from "./tutorial-evaluation";
import type { Tutorial } from "./useTutorial";

/**
 * Evaluates edits made in the practice tab and advances the writing
 * lessons that are about the text. The callback stays stable for
 * Milkdown's once-registered change listener while a latest-value ref
 * keeps the tutorial state current.
 */
export function useTutorialDocumentEvaluation(tutorial: Tutorial) {
  const tutorialRef = useLatest(tutorial);

  return useCallback(
    (tabId: string, markdown: string) => {
      const current = tutorialRef.current;
      if (!current.active || tabId !== current.tabId) return;
      if (current.step.id === "wysiwyg") {
        // OR'd in: a part done once stays done if it is edited away.
        const parts = evaluateWysiwyg(markdown);
        current.setPhase((phase) => phase | parts);
      } else if (current.step.id === "blocks" && hasBlock(markdown)) {
        current.setPhase(1);
      }
    },
    [tutorialRef],
  );
}
