import { useCallback } from "react";
import type { Lang } from "../i18n/strings";
import { useLatest } from "../utils/hooks/useLatest";
import { practiceNotes } from "./practice-notes";
import {
  evaluateMarks,
  evaluateTable,
  evaluateWysiwyg,
  GRAMMAR_PART,
  hasFormulaOrDiagram,
  hasSentence,
  LESSON_DONE,
} from "./tutorial-evaluation";
import type { Tutorial } from "./useTutorial";

/**
 * Evaluates edits made in the practice tab and ticks off what the lessons
 * about the text ask for. The callback stays stable for Milkdown's
 * once-registered change listener while a latest-value ref keeps the
 * tutorial state current. Parts are OR'd in: a line done once stays done
 * if it is edited away.
 */
export function useTutorialDocumentEvaluation(
  tutorial: Tutorial,
  language: Lang,
) {
  const tutorialRef = useLatest(tutorial);
  const languageRef = useLatest(language);

  return useCallback(
    (tabId: string, markdown: string) => {
      const current = tutorialRef.current;
      if (!current.active || tabId !== current.tabId) return;
      const notes = practiceNotes(languageRef.current);
      let parts = 0;
      switch (current.step.id) {
        case "wysiwyg":
          parts = evaluateWysiwyg(markdown);
          break;
        case "marks":
          parts = evaluateMarks(markdown, notes.body);
          break;
        case "table":
          parts = evaluateTable(markdown);
          break;
        case "blocks":
          parts = hasFormulaOrDiagram(markdown) ? LESSON_DONE : 0;
          break;
        case "grammar":
          parts = hasSentence(markdown, notes.slip) ? GRAMMAR_PART.typed : 0;
          break;
      }
      if (parts) current.setPhase((phase) => phase | parts);
    },
    [tutorialRef, languageRef],
  );
}
