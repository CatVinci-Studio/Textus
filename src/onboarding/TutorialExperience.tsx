import { useCallback, useEffect, type ReactNode } from "react";
import type { Lang, Strings } from "../i18n/strings";
import { links } from "../platform/ipc";
import { isMacPlatform } from "../platform/os";
import { ProviderListPanel } from "../settings/sections/providers";
import { TextusAiOffNote } from "../ai/TextusAiSwitch";
import { useSettings } from "../settings/SettingsContext";
import { BUILTIN_CONTENT_THEMES } from "../theme/builtin-themes";
import { Select } from "../ui/Select";
import { practiceNotes } from "./practice-notes";
import {
  GRAMMAR_PART,
  isLessonComplete,
  isTaskDone,
} from "./tutorial-evaluation";
import { TutorialOverlay } from "./TutorialOverlay";
import { TUTORIAL_CHAPTERS, type TutorialTask } from "./tutorial-steps";
import type { Tutorial } from "./useTutorial";

/** How long the grammar lesson waits, once the sentence is typed, for the
 *  AI to flag something before it lets the learner go on without: a
 *  careful model may find nothing. */
export const GRAMMAR_WAIT_MS = 20_000;

interface TutorialExperienceProps {
  tutorial: Tutorial;
  t: Strings;
  language: Lang;
  /** The phone layout: no keyboard shortcuts, taps instead of Tab. */
  phone: boolean;
  shortcuts: { agentPanel: string; sidebar: string };
  /** Zen mode, for the modes-and-themes lesson's button. */
  zen: { on: boolean; toggle: () => void };
}

/**
 * Maps tutorial state to the card the learner sees: its copy, its gate,
 * its buttons. App owns the events that advance lessons; this owns
 * everything shown, keeping lesson copy and controls out of the shell.
 */
export function TutorialExperience({
  tutorial,
  t,
  language,
  phone,
  shortcuts,
  zen,
}: TutorialExperienceProps) {
  const { step, phase, setPhase, watching } = tutorial;
  const { settings } = useSettings();
  const live = tutorial.practiceAi === "live";
  const notes = practiceNotes(language);

  // The connect lesson's phase mirrors its provider's connection (1 / 0),
  // reported by the embedded Settings panel.
  const onConnectedChange = useCallback(
    (connected: boolean) => setPhase(connected ? 1 : 0),
    [setPhase],
  );

  // The grammar lesson, live: once the sentence is in, give the AI a while
  // to flag it before letting the learner on.
  const grammarWaiting =
    live &&
    step.id === "grammar" &&
    (phase & GRAMMAR_PART.typed) !== 0 &&
    (phase & GRAMMAR_PART.card) === 0;
  useEffect(() => {
    if (!grammarWaiting) return;
    const quiet = window.setTimeout(
      () =>
        setPhase((p) => (p & GRAMMAR_PART.card ? p : p | GRAMMAR_PART.quiet)),
      GRAMMAR_WAIT_MS,
    );
    return () => window.clearTimeout(quiet);
  }, [grammarWaiting, setPhase]);

  const mac = isMacPlatform();
  const lineText = (task: TutorialTask) =>
    t[(phone && task.phoneKey) || (mac && task.macKey) || task.key]
      .replace("{title}", notes.title)
      .replace("{slip}", notes.slip)
      .replace(
        "{shortcut}",
        step.id === "sidebar-export" ? shortcuts.sidebar : shortcuts.agentPanel,
      );
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
  } else if (step.id === "grammar" && phase & GRAMMAR_PART.quiet) {
    status = t.tutorialGrammarQuiet;
  } else if (step.id === "modes-themes") {
    controls = <ModesThemesControls t={t} zen={zen} />;
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

/** Zen mode, the first writing mode to hand, and the built-in themes - the
 *  same choice Settings › Theme makes. */
function ModesThemesControls({
  t,
  zen,
}: {
  t: Strings;
  zen: TutorialExperienceProps["zen"];
}) {
  const { settings, setSettings } = useSettings();
  return (
    <div className="tutorial-controls">
      <button
        type="button"
        className="tutorial-btn"
        aria-pressed={zen.on}
        onClick={zen.toggle}
      >
        {t.menuToggleZenMode}
      </button>
      <Select
        className="settings-select"
        aria-label={t.contentThemeLabel}
        value={settings.themeId}
        onChange={(e) => setSettings({ themeId: e.target.value })}
      >
        {BUILTIN_CONTENT_THEMES.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {t[theme.nameKey]}
          </option>
        ))}
        {settings.userThemes.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {theme.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
