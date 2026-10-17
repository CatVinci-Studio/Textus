import type { TextKey } from "../i18n/strings";

/**
 * The first-run tour, laid out like the website: the four things about
 * writing, connecting an AI, then the six kinds of Textus AI with the
 * panel they live in. Every lesson is one card - a title, one sentence,
 * one thing to do, and a link to its animation on the website.
 */

type TutorialChapterId = "start" | "writing" | "connect" | "ai" | "done";

export type TutorialStepId =
  | "welcome"
  | "wysiwyg"
  | "blocks"
  | "modes-themes"
  | "sidebar-export"
  | "connect"
  | "ai-panel"
  | "continuation"
  | "grammar"
  | "revision"
  | "review"
  | "skills"
  | "memory"
  | "done";

/** The lessons with an animation on the website's tutorials page, by the
 *  id of its clip there. Rust opens the page and accepts only these
 *  (TUTORIAL_CLIPS in src-tauri/src/commands/links.rs - change both). */
export type TutorialClipId = Exclude<
  TutorialStepId,
  "welcome" | "connect" | "done"
>;

export interface TutorialChapter {
  id: TutorialChapterId;
  titleKey: TextKey;
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
  /** What to do, when the lesson asks for something. */
  taskKey?: TextKey;
  /** Its clip on the website's tutorials page, when it has one. */
  clip?: TutorialClipId;
  /** A Textus AI lesson: with no AI connected it is watched, not done. */
  ai?: boolean;
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
    id: "wysiwyg",
    chapter: "writing",
    layout: "card",
    titleKey: "tutorialWysiwygTitle",
    bodyKey: "tutorialWysiwygBody",
    taskKey: "tutorialWysiwygTask",
    clip: "wysiwyg",
  },
  {
    id: "blocks",
    chapter: "writing",
    layout: "card",
    titleKey: "tutorialBlocksTitle",
    bodyKey: "tutorialBlocksBody",
    taskKey: "tutorialBlocksTask",
    clip: "blocks",
  },
  {
    id: "modes-themes",
    chapter: "writing",
    layout: "card",
    titleKey: "tutorialModesTitle",
    bodyKey: "tutorialModesBody",
    taskKey: "tutorialModesTask",
    clip: "modes-themes",
  },
  {
    id: "sidebar-export",
    chapter: "writing",
    layout: "card",
    titleKey: "tutorialSidebarTitle",
    bodyKey: "tutorialSidebarBody",
    taskKey: "tutorialSidebarTask",
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
    taskKey: "tutorialConnectTask",
  },
  {
    // Opens the real panel whether or not an AI is connected: it is where
    // the next lessons happen, and it works without one.
    id: "ai-panel",
    chapter: "ai",
    layout: "card",
    titleKey: "tutorialAiPanelTitle",
    bodyKey: "tutorialAiPanelBody",
    taskKey: "tutorialAiPanelTask",
    clip: "ai-panel",
    ai: true,
  },
  {
    id: "continuation",
    chapter: "ai",
    layout: "card",
    titleKey: "tutorialContinuationTitle",
    bodyKey: "tutorialContinuationBody",
    taskKey: "tutorialContinuationTask",
    clip: "continuation",
    ai: true,
  },
  {
    id: "grammar",
    chapter: "ai",
    layout: "card",
    titleKey: "tutorialGrammarTitle",
    bodyKey: "tutorialGrammarBody",
    taskKey: "tutorialGrammarTask",
    clip: "grammar",
    ai: true,
  },
  {
    id: "revision",
    chapter: "ai",
    layout: "card",
    titleKey: "tutorialRevisionTitle",
    bodyKey: "tutorialRevisionBody",
    taskKey: "tutorialRevisionTask",
    clip: "revision",
    ai: true,
  },
  {
    id: "review",
    chapter: "ai",
    layout: "card",
    titleKey: "tutorialReviewTitle",
    bodyKey: "tutorialReviewBody",
    taskKey: "tutorialReviewTask",
    clip: "review",
    ai: true,
  },
  {
    id: "skills",
    chapter: "ai",
    layout: "card",
    titleKey: "tutorialSkillsTitle",
    bodyKey: "tutorialSkillsBody",
    taskKey: "tutorialSkillsTask",
    clip: "skills",
    ai: true,
  },
  {
    id: "memory",
    chapter: "ai",
    layout: "card",
    titleKey: "tutorialMemoryTitle",
    bodyKey: "tutorialMemoryBody",
    taskKey: "tutorialMemoryTask",
    clip: "memory",
    ai: true,
  },
  {
    id: "done",
    chapter: "done",
    layout: "overlay",
    titleKey: "tutorialDoneTitle",
    bodyKey: "tutorialDoneBody",
  },
];

/** Every clip the tour links to, in tour order. */
export const TUTORIAL_CLIPS: readonly TutorialClipId[] = TUTORIAL_STEPS.flatMap(
  (step) => (step.clip ? [step.clip] : []),
);

export function stepIndexOf(id: TutorialStepId): number {
  return TUTORIAL_STEPS.findIndex((step) => step.id === id);
}

/** How the AI lessons run: for real with a connected AI ("live"), or as
 *  animations to watch ("watch"). Decided on leaving the connect lesson,
 *  null before that. */
export type TutorialAiMode = "live" | "watch";

/**
 * The tours before this one, by their step ids. Their writing lessons map
 * onto the matching new ones; anything in or after their AI chapter -
 * which ran on scripted replies and never asked about an AI - restarts at
 * the connect lesson, where the new AI chapter begins.
 */
const LEGACY_STEP_IDS = new Map<string, TutorialStepId>([
  ["welcome", "welcome"],
  ["markdownIntro", "wysiwyg"],
  ["markdownPractice", "wysiwyg"],
  ["sidebar", "sidebar-export"],
  ["aiIntro", "connect"],
  ["completion", "connect"],
  ["grammar", "connect"],
  ["agentChat", "connect"],
  ["agentEdit", "connect"],
  ["connectAi", "connect"],
  ["done", "done"],
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
 * one of this tour's, one of the tour before (LEGACY_STEP_IDS), or - from
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
  let id: TutorialStepId | undefined;
  if (typeof saved.stepId === "string") {
    id =
      TUTORIAL_STEPS.find((step) => step.id === saved.stepId)?.id ??
      LEGACY_STEP_IDS.get(saved.stepId);
  }
  if (!id) {
    const raw =
      typeof saved.stepIndex === "number" && Number.isFinite(saved.stepIndex)
        ? Math.trunc(saved.stepIndex)
        : 0;
    const legacy =
      LEGACY_INDEXED_IDS[
        Math.min(Math.max(0, raw), LEGACY_INDEXED_IDS.length - 1)
      ];
    id = LEGACY_STEP_IDS.get(legacy) ?? "welcome";
  }
  const step = TUTORIAL_STEPS[stepIndexOf(id)];
  if (step.ai && !aiMode)
    return { stepIndex: stepIndexOf("connect"), aiMode: null };
  return { stepIndex: stepIndexOf(id), aiMode };
}
