import type { TextKey } from "../i18n/strings";
import type { AgentMode } from "../settings/SettingsContext";
import {
  GRAMMAR_PART,
  LESSON_DONE,
  MARKS_PART,
  MODES_PART,
  TABLE_PART,
  WRITE_PART,
  WYSIWYG_PART,
} from "./tutorial-evaluation";

/**
 * The first-run tour, on reading notes about a classic (practice-notes.ts):
 * Markdown typed for real, the window around the editor, connecting an AI,
 * then Textus AI working on the learner's notes - never on the classic's
 * own words. Every lesson is one card: a title, one sentence, and the exact
 * things to type or click, one per line, each ticked off as it is done.
 * The animation on the website is an optional extra, never the way through.
 */

type TutorialChapterId = "start" | "writing" | "connect" | "ai" | "done";

export type TutorialStepId =
  | "welcome"
  | "wysiwyg"
  | "marks"
  | "table"
  | "blocks"
  | "modes-themes"
  | "sidebar-export"
  | "connect"
  | "write"
  | "review"
  | "revision"
  | "grammar"
  | "continuation"
  | "skills"
  | "done";

/** The clips on the website's tutorials page. Rust opens the page and
 *  accepts only these (TUTORIAL_CLIPS in src-tauri/src/commands/links.rs -
 *  change both). */
export const TUTORIAL_CLIPS = [
  "wysiwyg",
  "blocks",
  "modes-themes",
  "sidebar-export",
  "ai-panel",
  "continuation",
  "grammar",
  "revision",
  "review",
  "skills",
  "memory",
] as const;

export type TutorialClipId = (typeof TUTORIAL_CLIPS)[number];

export interface TutorialChapter {
  id: TutorialChapterId;
  titleKey: TextKey;
}

/** One line of what to do. */
export interface TutorialTask {
  key: TextKey;
  /** Its wording on a phone (taps, no shortcuts), where it differs. */
  phoneKey?: TextKey;
  /** Its wording on a Mac (the native menu bar), where it differs. */
  macKey?: TextKey;
  /** The bit of the lesson's phase that ticks this line. Without one it is
   *  ticked with the lesson. */
  part?: number;
}

export interface TutorialStep {
  id: TutorialStepId;
  chapter: TutorialChapterId;
  /** Opening, connecting and ending dim the app; lessons leave the editor
   *  to work in, the card at its side. */
  layout: "overlay" | "card";
  titleKey: TextKey;
  /** The one sentence under the title. */
  bodyKey: TextKey;
  /** What to do, a line each. */
  tasks?: TutorialTask[];
  /** Its clip on the website's tutorials page, when it has one. */
  clip?: TutorialClipId;
  /** A Textus AI lesson: with no AI connected it is watched, not done. */
  ai?: boolean;
  /** The AI panel's mode this lesson needs; the tour sets it. */
  agentMode?: AgentMode;
  /** Never locked: Continue is there whether or not it was tried. */
  optional?: boolean;
}

export const TUTORIAL_CHAPTERS: TutorialChapter[] = [
  { id: "start", titleKey: "tutorialChapterStart" },
  { id: "writing", titleKey: "tutorialChapterWriting" },
  { id: "connect", titleKey: "tutorialChapterConnect" },
  { id: "ai", titleKey: "tutorialChapterAi" },
  { id: "done", titleKey: "tutorialChapterDone" },
];

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    chapter: "start",
    layout: "overlay",
    titleKey: "tutorialWelcomeTitle",
    bodyKey: "tutorialWelcomeBody",
  },
  {
    // On an empty document: what the learner types here heads the notes.
    id: "wysiwyg",
    chapter: "writing",
    layout: "card",
    titleKey: "tutorialWysiwygTitle",
    bodyKey: "tutorialWysiwygBody",
    tasks: [
      { key: "tutorialWysiwygHeading", part: WYSIWYG_PART.heading },
      { key: "tutorialWysiwygList", part: WYSIWYG_PART.list },
      { key: "tutorialWysiwygNumbered", part: WYSIWYG_PART.numbered },
      { key: "tutorialWysiwygTaskItem", part: WYSIWYG_PART.task },
    ],
    clip: "wysiwyg",
  },
  {
    // The practice notes arrive here, under what was typed.
    id: "marks",
    chapter: "writing",
    layout: "card",
    titleKey: "tutorialMarksTitle",
    bodyKey: "tutorialMarksBody",
    tasks: [
      { key: "tutorialMarksEmphasis", part: MARKS_PART.emphasis },
      { key: "tutorialMarksQuote", part: MARKS_PART.quote },
      { key: "tutorialMarksCode", part: MARKS_PART.code },
      { key: "tutorialMarksLink", part: MARKS_PART.link },
    ],
    clip: "wysiwyg",
  },
  {
    id: "table",
    chapter: "writing",
    layout: "card",
    titleKey: "tutorialTableTitle",
    bodyKey: "tutorialTableBody",
    tasks: [
      { key: "tutorialTableHeader", part: TABLE_PART.table },
      { key: "tutorialTableRow", part: TABLE_PART.row },
    ],
    clip: "blocks",
  },
  {
    id: "blocks",
    chapter: "writing",
    layout: "card",
    titleKey: "tutorialBlocksTitle",
    bodyKey: "tutorialBlocksBody",
    tasks: [
      { key: "tutorialBlocksFormula", part: LESSON_DONE },
      { key: "tutorialBlocksDiagram", part: LESSON_DONE },
    ],
    clip: "blocks",
    optional: true,
  },
  {
    id: "modes-themes",
    chapter: "writing",
    layout: "card",
    titleKey: "tutorialModesTitle",
    bodyKey: "tutorialModesBody",
    tasks: [
      { key: "tutorialModesTask", part: MODES_PART.mode | MODES_PART.theme },
    ],
    clip: "modes-themes",
  },
  {
    id: "sidebar-export",
    chapter: "writing",
    layout: "card",
    titleKey: "tutorialSidebarTitle",
    bodyKey: "tutorialSidebarBody",
    tasks: [
      {
        key: "tutorialSidebarTask",
        macKey: "tutorialSidebarTaskMac",
        phoneKey: "tutorialSidebarTaskPhone",
      },
    ],
    clip: "sidebar-export",
  },
  {
    // The Settings › Textus AI provider controls, as they are there. Never
    // a gate: leaving it decides whether the AI lessons are done for real
    // or watched (useTutorial's aiMode).
    id: "connect",
    chapter: "connect",
    layout: "overlay",
    titleKey: "tutorialConnectTitle",
    bodyKey: "tutorialConnectBody",
    tasks: [{ key: "tutorialConnectTask" }],
  },
  {
    // Opens the real panel whether or not an AI is connected: it is where
    // the next lessons happen.
    id: "write",
    chapter: "ai",
    layout: "card",
    titleKey: "tutorialWriteTitle",
    bodyKey: "tutorialWriteBody",
    tasks: [
      {
        key: "tutorialWriteOpen",
        phoneKey: "tutorialWriteOpenPhone",
        part: WRITE_PART.panel,
      },
      { key: "tutorialWriteSend", part: LESSON_DONE },
    ],
    clip: "ai-panel",
    ai: true,
    agentMode: "write",
  },
  {
    id: "review",
    chapter: "ai",
    layout: "card",
    titleKey: "tutorialReviewTitle",
    bodyKey: "tutorialReviewBody",
    tasks: [{ key: "tutorialReviewTask" }],
    clip: "review",
    ai: true,
    agentMode: "review",
  },
  {
    id: "revision",
    chapter: "ai",
    layout: "card",
    titleKey: "tutorialRevisionTitle",
    bodyKey: "tutorialRevisionBody",
    tasks: [{ key: "tutorialRevisionSelect" }, { key: "tutorialRevisionSend" }],
    clip: "revision",
    ai: true,
    agentMode: "revise",
  },
  {
    // The slip is in a sentence the learner types, never in the classic.
    id: "grammar",
    chapter: "ai",
    layout: "card",
    titleKey: "tutorialGrammarTitle",
    bodyKey: "tutorialGrammarBody",
    tasks: [
      { key: "tutorialGrammarType", part: GRAMMAR_PART.typed },
      {
        key: "tutorialGrammarApply",
        phoneKey: "tutorialGrammarApplyPhone",
        part: GRAMMAR_PART.card,
      },
    ],
    clip: "grammar",
    ai: true,
  },
  {
    id: "continuation",
    chapter: "ai",
    layout: "card",
    titleKey: "tutorialContinuationTitle",
    bodyKey: "tutorialContinuationBody",
    tasks: [
      {
        key: "tutorialContinuationTask",
        phoneKey: "tutorialContinuationTaskPhone",
      },
    ],
    clip: "continuation",
    ai: true,
  },
  {
    id: "skills",
    chapter: "ai",
    layout: "card",
    titleKey: "tutorialSkillsTitle",
    bodyKey: "tutorialSkillsBody",
    tasks: [{ key: "tutorialSkillsTask" }],
    clip: "skills",
    ai: true,
    agentMode: "revise",
  },
  {
    id: "done",
    chapter: "done",
    layout: "overlay",
    titleKey: "tutorialDoneTitle",
    bodyKey: "tutorialDoneBody",
  },
];

export function stepIndexOf(id: TutorialStepId): number {
  return TUTORIAL_STEPS.findIndex((step) => step.id === id);
}

/** How the AI lessons run: for real with a connected AI ("live"), or
 *  watched ("watch"). Decided on leaving the connect lesson, null before
 *  that. */
export type TutorialAiMode = "live" | "watch";

/**
 * The tours before this one, by their step ids. The second tour's lessons
 * that are gone map onto their nearest; the first tour's writing lessons
 * onto the matching ones, and anything in or after its AI chapter - which
 * ran on scripted replies and never asked about an AI - restarts at the
 * connect lesson.
 */
const LEGACY_STEP_IDS = new Map<string, TutorialStepId>([
  // The second tour (1.1.0-rc.1 to rc.6).
  ["ai-panel", "write"],
  ["memory", "done"],
  // The first tour.
  ["markdownIntro", "wysiwyg"],
  ["markdownPractice", "wysiwyg"],
  ["sidebar", "sidebar-export"],
  ["aiIntro", "connect"],
  ["completion", "connect"],
  ["agentChat", "connect"],
  ["agentEdit", "connect"],
  ["connectAi", "connect"],
]);

/** The first tour's steps. Its progress holds only a `stepIndex` into
 *  this list (no `stepId`). */
const LEGACY_INDEXED_IDS = [
  "welcome",
  "markdownIntro",
  "markdownPractice",
  "sidebar",
  "aiIntro",
  "completion",
  "grammar",
  "agentChat",
  "agentEdit",
  "done",
] as const;

/**
 * Where saved progress resumes, and in which AI mode. Read by `stepId`:
 * one of this tour's, one of a tour before (LEGACY_STEP_IDS), or - from
 * the first tour - only a `stepIndex`. An AI lesson resumes only with its
 * mode saved beside it; without one (an older tour, or a damaged save) the
 * learner is asked about connecting again.
 */
export function resolveSavedProgress(saved: {
  stepId?: unknown;
  stepIndex?: unknown;
  aiMode?: unknown;
}): { stepIndex: number; aiMode: TutorialAiMode | null } {
  const aiMode =
    saved.aiMode === "live" || saved.aiMode === "watch" ? saved.aiMode : null;
  const known = (stepId: string) =>
    TUTORIAL_STEPS.find((step) => step.id === stepId)?.id ??
    LEGACY_STEP_IDS.get(stepId);
  let id = typeof saved.stepId === "string" ? known(saved.stepId) : undefined;
  if (!id) {
    const raw =
      typeof saved.stepIndex === "number" && Number.isFinite(saved.stepIndex)
        ? Math.trunc(saved.stepIndex)
        : 0;
    const legacy =
      LEGACY_INDEXED_IDS[
        Math.min(Math.max(0, raw), LEGACY_INDEXED_IDS.length - 1)
      ];
    id = known(legacy) ?? "welcome";
  }
  const step = TUTORIAL_STEPS[stepIndexOf(id)];
  if (step.ai && !aiMode)
    return { stepIndex: stepIndexOf("connect"), aiMode: null };
  return { stepIndex: stepIndexOf(id), aiMode };
}
