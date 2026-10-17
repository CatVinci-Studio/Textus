import type { Strings } from "../i18n/strings";
import {
  isTutorialPracticeComplete,
  MARKDOWN_ALL_TASKS,
  MARKDOWN_TASK,
  SIDEBAR_ALL_TABS,
  SIDEBAR_TAB,
} from "./tutorial-evaluation";
import { TutorialOverlay, type TutorialChecklistItem } from "./TutorialOverlay";
import { TUTORIAL_SECTIONS, TUTORIAL_STEPS } from "./tutorial-steps";
import type { Tutorial } from "./useTutorial";

interface TutorialExperienceProps {
  tutorial: Tutorial;
  t: Strings;
  shortcuts: {
    completion: string;
    grammar: string;
    agent: string;
    sidebar: string;
  };
}

const MARKDOWN_EXERCISES = [
  { labelKey: "tutorialMarkdownStepHeading", bit: MARKDOWN_TASK.heading },
  {
    labelKey: "tutorialMarkdownStepSubheading",
    bit: MARKDOWN_TASK.subheading,
  },
  { labelKey: "tutorialMarkdownStepBold", bit: MARKDOWN_TASK.bold },
  { labelKey: "tutorialMarkdownStepItalic", bit: MARKDOWN_TASK.italic },
  {
    labelKey: "tutorialMarkdownStepHighlight",
    bit: MARKDOWN_TASK.highlight,
  },
  { labelKey: "tutorialMarkdownStepCode", bit: MARKDOWN_TASK.code },
  { labelKey: "tutorialMarkdownStepFormula", bit: MARKDOWN_TASK.formula },
] as const;

const SIDEBAR_TABS = [
  { labelKey: "tutorialSidebarTree", bit: SIDEBAR_TAB.tree },
  { labelKey: "tutorialSidebarOutline", bit: SIDEBAR_TAB.outline },
  { labelKey: "tutorialSidebarClipboard", bit: SIDEBAR_TAB.clipboard },
  { labelKey: "tutorialSidebarChat", bit: SIDEBAR_TAB.chat },
] as const;

/**
 * Maps tutorial state to lesson presentation. App owns document events that
 * advance phases; this component owns everything the learner sees, keeping
 * step copy, completion gates, and controls out of the application shell.
 */
export function TutorialExperience({
  tutorial,
  t,
  shortcuts,
}: TutorialExperienceProps) {
  const { step, phase } = tutorial;
  const shortcut =
    step.id === "completion"
      ? shortcuts.completion
      : step.id === "grammar"
        ? shortcuts.grammar
        : step.id === "agentChat" || step.id === "agentEdit"
          ? shortcuts.agent
          : step.id === "sidebar"
            ? shortcuts.sidebar
            : "";
  const text = (value: string) => value.replace("{shortcut}", shortcut);
  // A body that already names its shortcut inline doesn't get it repeated
  // on a line of its own.
  const inlineShortcut = t[step.bodyKey].includes("{shortcut}");
  const body = [
    text(t[step.bodyKey]),
    shortcut && !inlineShortcut
      ? t.tutorialShortcut.replace("{shortcut}", shortcut)
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  let task: string | undefined;
  let checklist: TutorialChecklistItem[] | undefined;
  let status: string | null = null;
  let waiting = false;

  if (step.id === "markdownPractice") {
    checklist = MARKDOWN_EXERCISES.map(({ labelKey, bit }) => ({
      label: t[labelKey],
      done: !!(phase & bit),
      onSkip: () => tutorial.setPhase((current) => current | bit),
    }));
    const missing = checklist.find((item) => !item.done);
    status = missing ? missing.label : t.tutorialMarkdownDone;
    waiting = phase < MARKDOWN_ALL_TASKS;
  } else if (step.id === "sidebar") {
    checklist = SIDEBAR_TABS.map(({ labelKey, bit }) => ({
      label: t[labelKey],
      done: !!(phase & bit),
      onSkip: () => tutorial.setPhase((current) => current | bit),
    }));
    status = phase === SIDEBAR_ALL_TABS ? t.tutorialSidebarDone : null;
    waiting = phase < SIDEBAR_ALL_TABS;
  } else if (step.id === "completion") {
    task = t.tutorialCompletionTarget;
    status =
      phase === 0
        ? text(t.tutorialCompletionWaiting)
        : phase === 1
          ? text(t.tutorialCompletionGhostShown)
          : text(t.tutorialCompletionAccepted);
    waiting = phase < 2;
  } else if (step.id === "grammar") {
    task = t.tutorialGrammarTarget;
    status =
      phase === 0
        ? text(t.tutorialGrammarWaiting)
        : phase === 1
          ? text(t.tutorialGrammarShown)
          : text(t.tutorialGrammarFixed);
    waiting = phase < 2;
  } else if (step.id === "agentChat") {
    task = t.tutorialAgentChatPrompt;
    status =
      phase === 0
        ? text(t.tutorialAgentChatWaiting)
        : text(t.tutorialAgentChatReplied);
    waiting = phase === 0;
  } else if (step.id === "agentEdit") {
    task = phase === 0 ? t.tutorialAgentEditTarget : t.tutorialAgentEditPrompt;
    status =
      phase === 0
        ? text(t.tutorialAgentEditWaiting)
        : phase === 1
          ? text(t.tutorialAgentEditReady)
          : phase === 2
            ? text(t.tutorialAgentEditProposed)
            : text(t.tutorialAgentEditApplied);
    waiting = phase < 3;
  }

  const isLast = tutorial.stepIndex === tutorial.totalSteps - 1;
  const complete = isTutorialPracticeComplete(step.id, phase);
  const roadmap =
    step.id === "welcome" || step.id === "done"
      ? [
          t.tutorialMarkdownPracticeTitle,
          t.tutorialSidebarTitle,
          t.tutorialRoadmapAiTools,
          t.tutorialAgentChatTitle,
          t.tutorialAgentEditTitle,
        ]
      : undefined;
  const sectionIndex = TUTORIAL_SECTIONS.findIndex(
    (section) => section.id === step.section,
  );
  const sections = TUTORIAL_SECTIONS.map((section, index) => ({
    label: t[section.titleKey],
    active: index === sectionIndex,
    done: step.id === "done" || (sectionIndex >= 0 && index < sectionIndex),
  }));
  const chapterExercises = TUTORIAL_STEPS.filter(
    (candidate) =>
      candidate.section === step.section && candidate.layout === "card",
  );
  const activityIndex = chapterExercises.findIndex(
    (candidate) => candidate.id === step.id,
  );
  const activityNumber =
    activityIndex >= 0 ? String(activityIndex + 1).padStart(2, "0") : undefined;

  return (
    <TutorialOverlay
      layout={step.layout}
      stepId={step.id}
      stepIndex={tutorial.stepIndex}
      totalSteps={tutorial.totalSteps}
      sections={sections}
      activityNumber={activityNumber}
      title={t[step.titleKey]}
      body={body}
      task={task}
      checklist={checklist}
      roadmap={roadmap}
      status={status}
      waiting={waiting}
      complete={complete}
      primaryLabel={
        isLast
          ? t.tutorialFinish
          : step.id === "welcome"
            ? t.tutorialStart
            : t.tutorialNext
      }
      primaryDisabled={step.layout === "card" && !complete}
      onPrimary={tutorial.next}
      onBack={tutorial.back}
      onSkip={tutorial.skip}
      onSkipStep={step.layout === "card" ? tutorial.next : undefined}
      labels={{
        back: t.tutorialBack,
        collapse: t.tutorialCollapse,
        expand: t.tutorialExpand,
        skip: t.tutorialSkip,
        skipStep: t.tutorialSkipStep,
        practice: t.tutorialPractice,
        learned: t.tutorialLearned,
        skipItem: t.tutorialSkipItem,
        courseSections: t.tutorialCourseSections,
        stepOfCount: t.tutorialStepOfCount,
      }}
    />
  );
}
