import { useCallback, type ReactNode } from "react";
import type { Lang, Strings } from "../i18n/strings";
import { links } from "../platform/ipc";
import { isMacPlatform } from "../platform/os";
import { ProviderListPanel } from "../settings/sections/providers";
import { TextusAiOffNote } from "../ai/TextusAiSwitch";
import { useSettings } from "../prefs/SettingsContext";
import { practiceNotes } from "./practice-notes";
import { isLessonComplete, isTaskDone } from "./tutorial-evaluation";
import { TutorialOverlay } from "./TutorialOverlay";
import {
  TUTORIAL_CHAPTERS,
  type TutorialStepId,
  type TutorialTask,
} from "./tutorial-steps";
import type { Tutorial } from "./useTutorial";

interface TutorialExperienceProps {
  tutorial: Tutorial;
  t: Strings;
  language: Lang;
  /** The phone layout: no keyboard shortcuts, taps instead of Tab. */
  phone: boolean;
  shortcuts: LessonShortcuts;
}

/** Maps tutorial state to the card the learner sees: its copy, gate and
 *  buttons. App owns the events that advance lessons. */
interface LessonShortcuts {
  agentPanel: string;
  palette: string;
}

/** The shortcut a lesson's "{shortcut}" names. */
function lessonShortcut(id: TutorialStepId, shortcuts: LessonShortcuts) {
  if (id === "palette") return shortcuts.palette;
  return shortcuts.agentPanel;
}

export function TutorialExperience({
  tutorial,
  t,
  language,
  phone,
  shortcuts,
}: TutorialExperienceProps) {
  const { step, phase, setPhase, watching } = tutorial;
  const { settings } = useSettings();
  const notes = practiceNotes(language);

  // The connect lesson's phase mirrors its provider's connection (1 / 0),
  // reported by the embedded Settings panel.
  const onConnectedChange = useCallback(
    (connected: boolean) => setPhase(connected ? 1 : 0),
    [setPhase],
  );

  const mac = isMacPlatform();
  const lineText = (task: TutorialTask) =>
    t[(phone && task.phoneKey) || (mac && task.macKey) || task.key]
      .replace("{title}", notes.title)
      .replace("{shortcut}", lessonShortcut(step.id, shortcuts));
  const tasks = step.tasks?.map((task) => ({
    text: lineText(task),
    done:
      !watching && step.layout === "card" && isTaskDone(step, task.part, phase),
  }));

  const complete = isLessonComplete(step, phase);
  const watch = step.clip
    ? {
        label: t.tutorialWatch,
        onClick: () => void links.openTutorialsPage(language, step.clip),
      }
    : null;
  const settingsPath = `${t.settingsTitle} › ${t.navAi}`;

  let status: string | null = null;
  let note: string | null = watching
    ? t.tutorialWatchNote.replace("{path}", settingsPath)
    : null;
  let controls: ReactNode = null;
  if (step.id === "connect") {
    status = phase >= 1 ? t.tutorialConnected : null;
    // Nothing to connect while Textus AI is off: its lessons are watched.
    controls = settings.textusAi ? (
      <ProviderListPanel
        t={t}
        expandCredentials
        onActiveConnectedChange={onConnectedChange}
      />
    ) : (
      <TextusAiOffNote />
    );
  } else if (step.id === "done") {
    note = t.tutorialDoneMemory;
    controls = (
      <div className="tutorial-links">
        <button
          type="button"
          className="tutorial-btn"
          onClick={() => void links.openTutorialsPage(language)}
        >
          {t.menuHelpTutorials}
        </button>
        <button
          type="button"
          className="tutorial-btn"
          onClick={() => void links.openCommunityPage(language)}
        >
          {t.menuHelpCommunity}
        </button>
      </div>
    );
  }

  const chapterIndex = TUTORIAL_CHAPTERS.findIndex(
    (chapter) => chapter.id === step.chapter,
  );
  const chapters = TUTORIAL_CHAPTERS.map((chapter, index) => ({
    label: t[chapter.titleKey],
    active: index === chapterIndex,
    done: index < chapterIndex,
  }));

  // A watched AI lesson can't be done here, so it never locks.
  const isLast = tutorial.stepIndex === tutorial.totalSteps - 1;
  const gated = step.layout === "card" && !watching && !step.optional;
  const primary = {
    label: isLast
      ? t.tutorialFinish
      : step.id === "welcome"
        ? t.tutorialStart
        : step.id === "connect" && phase < 1
          ? t.tutorialConnectSkip
          : t.tutorialNext,
    onClick: tutorial.next,
    disabled: gated && !complete,
  };

  return (
    <TutorialOverlay
      layout={step.layout}
      stepId={step.id}
      stepIndex={tutorial.stepIndex}
      totalSteps={tutorial.totalSteps}
      chapters={chapters}
      title={t[step.titleKey]}
      body={t[step.bodyKey]}
      tasks={tasks}
      status={status}
      complete={step.id !== "connect" && !watching && complete}
      note={note}
      watch={watch}
      primary={primary}
      onBack={tutorial.back}
      onSkip={tutorial.exit}
      onSkipStep={gated ? tutorial.next : undefined}
      phone={phone}
      labels={{
        back: t.tutorialBack,
        collapse: t.tutorialCollapse,
        expand: t.tutorialExpand,
        skip: t.tutorialSkip,
        skipStep: t.tutorialSkipStep,
        tryIt: t.tutorialTryIt,
        chapters: t.tutorialChapters,
        stepOfCount: t.tutorialStepOfCount,
      }}
    >
      {controls}
    </TutorialOverlay>
  );
}
