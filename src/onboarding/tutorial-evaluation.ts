import type { TutorialStepId } from "./tutorial-steps";

/** The WYSIWYG lesson's two parts, as bits of its phase. */
export const WYSIWYG_PART = { heading: 1, list: 2 } as const;
/** The modes-and-themes lesson's two parts, as bits of its phase. */
export const MODES_PART = { mode: 1, theme: 2 } as const;

/** The grammar lesson's phase once the AI has had its chance and found
 *  nothing: the lesson may be left, with a word saying why. */
export const GRAMMAR_QUIET = 2;

/** What the WYSIWYG lesson asks for, found in the practice document: a
 *  level-one heading and a list (bulleted, numbered or a task list). */
export function evaluateWysiwyg(markdown: string): number {
  const heading = /^#[ \t]+\S/m.test(markdown);
  const list = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\S/m.test(markdown);
  return (heading ? WYSIWYG_PART.heading : 0) | (list ? WYSIWYG_PART.list : 0);
}

/** The blocks lesson asks for a table; a formula or a diagram, the other
 *  two it is about, count as well. */
export function hasBlock(markdown: string): boolean {
  const table = /^[ \t]*\|.*\|[ \t]*\n[ \t]*\|?[ \t:|-]*-[ \t:|-]*$/m.test(
    markdown,
  );
  const formula =
    /\$\$[^$]+\$\$/s.test(markdown) || /\$[^$\n]+\$/.test(markdown);
  const diagram = /^```mermaid\b/m.test(markdown);
  return table || formula || diagram;
}

/** Whether a lesson's exercise is done. Lessons without one (the opening,
 *  connecting, the end) are always done; connecting is never a gate. */
export function isLessonComplete(
  stepId: TutorialStepId,
  phase: number,
): boolean {
  switch (stepId) {
    case "wysiwyg":
      return phase === (WYSIWYG_PART.heading | WYSIWYG_PART.list);
    case "modes-themes":
      return phase === (MODES_PART.mode | MODES_PART.theme);
    case "blocks":
    case "sidebar-export":
    case "ai-panel":
    case "continuation":
    case "grammar":
    case "revision":
    case "review":
    case "skills":
    case "memory":
      return phase >= 1;
    case "welcome":
    case "connect":
    case "done":
      return true;
  }
}
