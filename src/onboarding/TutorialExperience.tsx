import { useCallback, useEffect, type ReactNode } from "react";
import type { Lang, Strings, TextKey } from "../i18n/strings";
import { links } from "../platform/ipc";
import { ProviderListPanel } from "../settings/sections/providers";
import { useSettings } from "../settings/SettingsContext";
import { BUILTIN_CONTENT_THEMES } from "../theme/builtin-themes";
import { Select } from "../ui/Select";
import { TOUR_GRAMMAR_CHECK_EVENT } from "../utils/events";
import { practiceDiary } from "./practice-diary";
import { GRAMMAR_QUIET, isLessonComplete } from "./tutorial-evaluation";
import { TutorialOverlay } from "./TutorialOverlay";
import { TUTORIAL_CHAPTERS } from "./tutorial-steps";
import type { TutorialStepId } from "./tutorial-steps";
import type { Tutorial } from "./useTutorial";

/** How long the grammar lesson waits for the AI to flag something before
 *  it lets the learner go on without: a careful model may find nothing. */
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

/** What a lesson asks on a phone, where it differs. */
const PHONE_TASKS: Partial<Record<TutorialStepId, TextKey>> = {
  "sidebar-export": "tutorialSidebarTaskPhone",
  "ai-panel": "tutorialAiPanelTaskPhone",
  continuation: "tutorialContinuationTaskPhone",
};

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
  const live = tutorial.practiceAi === "live";
  const diary = practiceDiary(language);

  // The connect lesson's phase mirrors its provider's connection (1 / 0),
  // reported by the embedded Settings panel.
  const onConnectedChange = useCallback(
    (connected: boolean) => setPhase(connected ? 1 : 0),
    [setPhase],
  );

  // The grammar lesson, live: check the paragraph with the diary's slip,
  // and give the AI a while to find it before letting the learner on.
  const grammarLive = live && step.id === "grammar";
  useEffect(() => {
    if (!grammarLive) return;
    const check = window.setTimeout(
      () =>
        window.dispatchEvent(
          new CustomEvent(TOUR_GRAMMAR_CHECK_EVENT, { detail: diary.slip }),
        ),
      300,
    );
    const quiet = window.setTimeout(
      () => setPhase((p) => p || GRAMMAR_QUIET),
      GRAMMAR_WAIT_MS,
    );
    return () => {
      window.clearTimeout(check);
      window.clearTimeout(quiet);
    };
  }, [grammarLive, diary.slip, setPhase]);

  const complete = isLessonComplete(step.id, phase);
  const taskKey = (phone && PHONE_TASKS[step.id]) || step.taskKey;
  const task = taskKey
    ? t[taskKey]
        .replace("{title}", diary.title)
        .replace(
          "{shortcut}",
          step.id === "ai-panel" ? shortcuts.agentPanel : shortcuts.sidebar,
        )
    : undefined;
  const watch = step.clip
    ? {
        label: t.tutorialWatch,
        onClick: () => void links.openTutorialsPage(language, step.clip),
      }
    : null;
  const settingsPath = `${t.settingsTitle} › ${t.navAi}`;

  let status: string | null = null;
  let controls: ReactNode = null;
  if (step.id === "connect") {
    status = phase >= 1 ? t.tutorialConnected : null;
    controls = (
      <ProviderListPanel
        t={t}
        expandCredentials
        onActiveConnectedChange={onConnectedChange}
      />
    );
  } else if (step.id === "grammar" && phase === GRAMMAR_QUIET) {
    status = t.tutorialGrammarQuiet;
  } else if (step.id === "modes-themes") {
    controls = <ModesThemesControls t={t} zen={zen} />;
  } else if (step.id === "done") {
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

  const isLast = tutorial.stepIndex === tutorial.totalSteps - 1;
  const gated = step.layout === "card" && !watching;
  const primary =
    watching && watch
      ? watch
      : {
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
      task={task}
      status={status}
      complete={step.id !== "connect" && !watching && complete}
      note={
        watching ? t.tutorialWatchNote.replace("{path}", settingsPath) : null
      }
      watch={watching ? null : watch}
      primary={primary}
      secondary={
        watching ? { label: t.tutorialNext, onClick: tutorial.next } : null
      }
      onBack={tutorial.back}
      onSkip={tutorial.skip}
      onSkipStep={gated ? tutorial.next : undefined}
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
