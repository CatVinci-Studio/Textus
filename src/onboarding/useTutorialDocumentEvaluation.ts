import { useCallback } from "react";
import { useLatest } from "../utils/hooks/useLatest";
import { evaluateWysiwyg } from "./tutorial-evaluation";
import type { Tutorial } from "./useTutorial";

/**
 * Ticks off what the Markdown lesson asks for, from edits in the practice tab.
 * The callback stays stable for Milkdown's once-registered listener; a ref
 * keeps state current. Parts are OR'd in, so a line done once stays done.
 */
export function useTutorialDocumentEvaluation(tutorial: Tutorial) {
  const tutorialRef = useLatest(tutorial);

  return useCallback(
    (tabId: string, markdown: string) => {
      const current = tutorialRef.current;
      if (!current.active || tabId !== current.tabId) return;
      const parts =
        current.step.id === "wysiwyg" ? evaluateWysiwyg(markdown) : 0;
      if (parts) current.setPhase((phase) => phase | parts);
    },
    [tutorialRef],
  );
}
