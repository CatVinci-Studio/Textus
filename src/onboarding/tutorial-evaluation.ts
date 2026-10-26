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

export const MARKS_PART = { emphasis: 1, quote: 2, code: 4, link: 8 } as const;

/** The table lesson: a table, then a row filled in. */
export const TABLE_PART = { table: 1, row: 2 } as const;

export const MODES_PART = { mode: 1, theme: 2 } as const;

/** The AI writing lesson: the panel open, then the new text decided. */
export const WRITE_PART = { done: LESSON_DONE, panel: 2 } as const;

/** The grammar lesson: the card opened (the lesson's signal), the sentence
 *  typed, and quiet once it has waited with nothing flagged. */
export const GRAMMAR_PART = { card: LESSON_DONE, typed: 2, quiet: 4 } as const;

/** The lines of `markdown` that aren't in `own` (the practice notes as the
 *  tour wrote them): what the learner typed. */
function typedLines(markdown: string, own: string): string[] {
  const theirs = new Set(
    own
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  return markdown.split("\n").filter((line) => !theirs.has(line.trim()));
}

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

/** Bold and italic, a quote, inline code and a link, in the lines the
 *  learner added: the notes' own excerpt is a quote already. */
export function evaluateMarks(markdown: string, own: string): number {
  const lines = typedLines(markdown, own);
  const text = lines.join("\n");
  const bold = /(\*\*|__)(?=\S)[^\n]*?\S\1/.test(text);
  const italic = /(?<![*\w])\*(?=[^\s*])[^*\n]*[^\s*]\*(?!\*)/.test(text);
  const quote = lines.some((line) => /^[ \t]*>[ \t]*\S/.test(line));
  const code = /(?<!`)`[^`\n]+`(?!`)/.test(text);
  const link = /\[[^\]\n]+\]\([^)\s]+\)/.test(text);
  return (
    (bold && italic ? MARKS_PART.emphasis : 0) |
    (quote ? MARKS_PART.quote : 0) |
    (code ? MARKS_PART.code : 0) |
    (link ? MARKS_PART.link : 0)
  );
}

const TABLE =
  /^[ \t]*\|.*\|[ \t]*\n[ \t]*\|?[ \t:|-]*-[ \t:|-]*\n((?:[ \t]*\|.*\|[ \t]*(?:\n|$))*)/m;

/** A table, and a body row with something in it. */
export function evaluateTable(markdown: string): number {
  const table = TABLE.exec(markdown);
  if (!table) return 0;
  const filled = table[1]
    .split("\n")
    .some((row) => row.replace(/[|\s]/g, "").length > 0);
  return TABLE_PART.table | (filled ? TABLE_PART.row : 0);
}

/** A formula or a Mermaid diagram (the optional lesson). */
export function hasFormulaOrDiagram(markdown: string): boolean {
  const formula =
    /\$\$[^$]+\$\$/s.test(markdown) || /\$[^$\n]+\$/.test(markdown);
  const diagram = /^```mermaid\b/m.test(markdown);
  return formula || diagram;
}

/** The grammar lesson's sentence, typed: the same words, however the
 *  editor spaced them. */
export function hasSentence(markdown: string, sentence: string): boolean {
  const squash = (text: string) => text.replace(/\s+/g, "");
  return squash(markdown).includes(squash(sentence));
}

/** Whether a lesson's exercise is done. The opening, connecting and the
 *  end are never a gate; nor is an optional lesson. */
export function isLessonComplete(step: TutorialStep, phase: number): boolean {
  if (step.layout === "overlay" || step.optional) return true;
  if (step.id === "grammar" && phase & GRAMMAR_PART.quiet) return true;
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
