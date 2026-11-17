import { useCallback } from "react";
import { useLatest } from "../utils/hooks/useLatest";
import { formatsIn } from "./tutorial-evaluation";
import type { Tutorial } from "./useTutorial";

/**
 * Ticks off each kind of Markdown the editor step asks for as the learner
 * types it in the practice tab, and moves on once all are done. Stable for Milkdown's once-registered listener; a ref keeps
 * the tour current.
 */
export function useTutorialDocumentEvaluation(tutorial: Tutorial) {
  const tutorialRef = useLatest(tutorial);
  return useCallback(
    (tabId: string, markdown: string) => {
      const current = tutorialRef.current;
      if (!current.active || tabId !== current.tabId) return;
      const tasks = current.step.tasks;
      if (current.step.until !== "formatted" || !tasks) return;
      const seen = formatsIn(markdown);
      const done = tasks.filter((task) => seen.includes(task.format));
      if (done.length === tasks.length) return current.next();
      if (done.length !== current.done.length)
        current.setDone(done.map((task) => task.format));
    },
    [tutorialRef],
  );
}
