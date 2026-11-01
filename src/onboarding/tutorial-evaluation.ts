import type { TutorialStep } from "./tutorial-steps";

/**
 * What the lessons ask for, found in what the learner did. A phase is a set
 * of bits, one per task line's `part`; a lesson without parts is done on
 * LESSON_DONE.
 */

export const LESSON_DONE = 1;

export const WYSIWYG_PART = {
  heading: 1,
  list: 2,
  numbered: 4,
  task: 8,
} as const;

/** The AI writing lesson: the panel open, then the new text decided. */
export const WRITE_PART = { done: LESSON_DONE, panel: 2 } as const;

/** A heading, a bulleted list, a numbered list and a task, as typed. */
export function evaluateWysiwyg(markdown: string): number {
  let parts = 0;
  for (const line of markdown.split("\n")) {
    if (/^#[ \t]+\S/.test(line)) parts |= WYSIWYG_PART.heading;
    if (/^[ \t]*[-*+][ \t]+\[[ xX]\]([ \t]+\S|$)/.test(line))
      parts |= WYSIWYG_PART.task;
    else if (/^[ \t]*[-*+][ \t]+\S/.test(line)) parts |= WYSIWYG_PART.list;
    if (/^[ \t]*\d+[.)][ \t]+\S/.test(line)) parts |= WYSIWYG_PART.numbered;
  }
  return parts;
}

/** Whether a lesson's exercise is done. The opening, connecting and the
 *  end are never a gate; nor is an optional lesson. */
export function isLessonComplete(step: TutorialStep, phase: number): boolean {
  if (step.layout === "overlay" || step.optional) return true;
  const required =
    step.tasks?.reduce((all, task) => all | (task.part ?? 0), 0) || LESSON_DONE;
  return (phase & required) === required;
}

export function isTaskDone(
  step: TutorialStep,
  part: number | undefined,
  phase: number,
): boolean {
  if (part === undefined) return isLessonComplete(step, phase);
  return (phase & part) === part;
}
