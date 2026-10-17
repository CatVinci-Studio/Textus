import type { GrammarIssue } from "../ai/writing/grammar-check-plugin";
import type { TutorialStepId } from "./tutorial-steps";

/** Detail of TUTORIAL_MOCK_GRAMMAR_EVENT: the practice sentence the issues'
 *  offsets are relative to, plus the pre-written issues themselves. */
export interface TutorialGrammarMock {
  target: string;
  issues: GrammarIssue[];
}

/**
 * Re-bases mock issue offsets from target-relative to paragraph-relative.
 * The learner may type the practice sentence after existing text in the same
 * paragraph; grammar decorations resolve offsets against the paragraph's
 * whole text, so a mismatch would silently drop the underline (the plugin's
 * original-text check) and strand the lesson. Offsets count Unicode scalars,
 * matching the decoration contract.
 */
export function anchorGrammarIssues(
  paragraphText: string,
  { target, issues }: TutorialGrammarMock,
): GrammarIssue[] {
  const found = paragraphText.lastIndexOf(target);
  if (found <= 0) return issues;
  const base = [...paragraphText.slice(0, found)].length;
  return issues.map((issue) => ({
    ...issue,
    start: issue.start + base,
    end: issue.end + base,
  }));
}

export const MARKDOWN_TASK = {
  heading: 1,
  subheading: 2,
  bold: 4,
  italic: 8,
  highlight: 16,
  code: 32,
  formula: 64,
} as const;

export const MARKDOWN_ALL_TASKS = 127;

/** The sidebar lesson's phase: one bit per tab the learner has looked at. */
export const SIDEBAR_TAB = {
  tree: 1,
  outline: 2,
  clipboard: 4,
  chat: 8,
} as const;

export const SIDEBAR_ALL_TABS = 15;

/**
 * Grades the Markdown practice page. Each task is independent, so learners
 * can complete the examples in any order and the UI can light up precisely
 * the items already present in the document.
 */
export function evaluateMarkdownTasks(markdown: string): number {
  const hasHeading = /^#[ \t]+\S/m.test(markdown);
  const hasSubheading = /^##[ \t]+\S/m.test(markdown);
  const hasBold = /\*\*[^*\n]+\*\*/.test(markdown);
  const hasItalic = /(^|[^*])\*(?!\*)[^*\s][^*\n]*\*(?!\*)/.test(markdown);
  const hasHighlight = /==[^=\n]+==/.test(markdown);
  const hasCode = /`[^`\n]+`/.test(markdown);
  const hasFormula =
    /\$[^$\n]+\$/.test(markdown) || /\$\$[^$]+\$\$/s.test(markdown);

  return (
    (hasHeading ? MARKDOWN_TASK.heading : 0) |
    (hasSubheading ? MARKDOWN_TASK.subheading : 0) |
    (hasBold ? MARKDOWN_TASK.bold : 0) |
    (hasItalic ? MARKDOWN_TASK.italic : 0) |
    (hasHighlight ? MARKDOWN_TASK.highlight : 0) |
    (hasCode ? MARKDOWN_TASK.code : 0) |
    (hasFormula ? MARKDOWN_TASK.formula : 0)
  );
}

/** The completion gate shared by the lesson UI and its tests. */
export function isTutorialPracticeComplete(
  stepId: TutorialStepId,
  phase: number,
): boolean {
  switch (stepId) {
    case "markdownPractice":
      return phase === MARKDOWN_ALL_TASKS;
    case "sidebar":
      return phase === SIDEBAR_ALL_TABS;
    case "completion":
    case "grammar":
      return phase >= 2;
    case "agentChat":
      return phase >= 1;
    case "agentEdit":
      return phase >= 3;
    // Never a gate: connecting is optional. Its phase only says whether the
    // selected provider is connected (1) or not (0).
    case "connectAi":
    case "welcome":
    case "markdownIntro":
    case "aiIntro":
    case "done":
      return true;
  }
}
