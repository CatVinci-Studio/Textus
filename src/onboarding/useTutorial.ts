import { useCallback, useEffect, useState, type SetStateAction } from "react";
import { useLatest } from "../utils/hooks/useLatest";
import {
  resolveSavedProgress,
  stepIndexOf,
  TUTORIAL_STEPS,
  type TutorialAiMode,
  type TutorialStepId,
} from "./tutorial-steps";
import { getUiState, setUiState } from "../storage/ui-state";
import {
  TOUR_SIGNAL_EVENT,
  type TourAi,
  type TourSignal,
} from "../utils/events";

interface TutorialProgress {
  active: boolean;
  stepIndex: number;
  /** The practice tab this run is bound to - orchestration only reacts to
   *  edits in that tab, so the tour never reads (or looks like it's
   *  grading) a document the user opened for real work. */
  tabId: string | null;
  /** How the AI lessons run, decided on leaving the connect lesson. */
  aiMode: TutorialAiMode | null;
}

const IDLE_PROGRESS: TutorialProgress = {
  active: false,
  stepIndex: 0,
  tabId: null,
  aiMode: null,
};

const CONNECT = stepIndexOf("connect");
const AI_PANEL = stepIndexOf("ai-panel");

/** The lesson each signal from the practice tab completes. */
const SIGNAL_LESSON: Record<TourSignal, TutorialStepId> = {
  "completion-accepted": "continuation",
  "grammar-card": "grammar",
  "revision-decided": "revision",
  "review-note": "review",
  reply: "review",
  "skill-sent": "skills",
};

function loadProgress(): TutorialProgress {
  try {
    const parsed = getUiState("tutorialProgress") as Record<
      string,
      unknown
    > | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return IDLE_PROGRESS;
    return {
      active: parsed.active === true,
      ...resolveSavedProgress(parsed),
      tabId: typeof parsed.tabId === "string" ? parsed.tabId : null,
    };
  } catch {
    return IDLE_PROGRESS;
  }
}

/**
 * The onboarding tour's state machine. Progress - the step, its practice
 * tab and the AI mode - is persisted (UI state, storage/ui-state.ts), so
 * quitting mid-tour resumes at the same lesson, done the same way, on
 * relaunch. `phase` is the current lesson's own progress and deliberately
 * is NOT persisted: a resumed lesson starts over, which is always safe.
 *
 * Every phase advance is something the learner actually did. What
 * advances it lives where its input is: the practice document's text
 * (useTutorialDocumentEvaluation), the window's panels and modes
 * (app/onboarding-wiring.ts), and the AI's results in the practice tab,
 * which arrive here as tour signals (utils/events.ts).
 */
export function useTutorial() {
  const [progress, setProgress] = useState<TutorialProgress>(loadProgress);
  // Each lesson keeps its completion while moving Back/Continue, so
  // learners can revisit cards without redoing them. Session-only.
  const [phases, setPhases] = useState<Partial<Record<TutorialStepId, number>>>(
    {},
  );
  const phasesRef = useLatest(phases);

  // The step's id is saved beside its index and is what a resume reads, so
  // a step added later can't shift a saved run onto the wrong lesson.
  useEffect(() => {
    setUiState("tutorialProgress", {
      ...progress,
      stepId: TUTORIAL_STEPS[progress.stepIndex].id,
    });
  }, [progress]);

  const start = useCallback((tabId: string) => {
    setPhases({});
    setProgress({ active: true, stepIndex: 0, tabId, aiMode: null });
  }, []);

  // Leaving the connect lesson forward decides the AI lessons: done for
  // real when its provider is connected (phase 1), watched otherwise.
  const next = useCallback(() => {
    setProgress((p) => {
      if (!p.active) return p;
      if (p.stepIndex + 1 >= TUTORIAL_STEPS.length) return IDLE_PROGRESS;
      const aiMode =
        p.stepIndex === CONNECT
          ? (phasesRef.current.connect ?? 0) >= 1
            ? "live"
            : "watch"
          : p.aiMode;
      return { ...p, stepIndex: p.stepIndex + 1, aiMode };
    });
  }, [phasesRef]);

  const back = useCallback(() => {
    setProgress((p) =>
      p.active ? { ...p, stepIndex: Math.max(0, p.stepIndex - 1) } : p,
    );
  }, []);

  const exit = useCallback(() => setProgress(IDLE_PROGRESS), []);

  const step = TUTORIAL_STEPS[progress.stepIndex];
  const { active, aiMode } = progress;
  const phase = phases[step.id] ?? 0;
  const setPhase = useCallback(
    (next: SetStateAction<number>) => {
      setPhases((prev) => {
        const current = prev[step.id] ?? 0;
        const value = typeof next === "function" ? next(current) : next;
        return value === current ? prev : { ...prev, [step.id]: value };
      });
    },
    [step.id],
  );

  useEffect(() => {
    if (!active) return;
    const handler = (e: Event) => {
      const lesson = SIGNAL_LESSON[(e as CustomEvent<TourSignal>).detail];
      if (lesson === step.id) setPhase((p) => Math.max(p, 1));
    };
    window.addEventListener(TOUR_SIGNAL_EVENT, handler);
    return () => window.removeEventListener(TOUR_SIGNAL_EVENT, handler);
  }, [active, step.id, setPhase]);

  // Rebinds an in-progress tutorial to a different tab id, keeping the
  // current step - used when the practice tab didn't survive a relaunch
  // (it's a pathless draft, so it's never part of session restore) so the
  // tutorial resumes on a live tab instead of pointing at one that no
  // longer exists.
  const rebindTab = useCallback((tabId: string) => {
    setProgress((p) => (p.active ? { ...p, tabId } : p));
  }, []);

  /** The practice tab's AI: live from the AI panel lesson on for a learner
   *  who connected one, muted everywhere else in the tour. */
  const practiceAi: TourAi =
    aiMode === "live" && progress.stepIndex >= AI_PANEL ? "live" : "muted";

  return {
    active,
    stepIndex: progress.stepIndex,
    step,
    totalSteps: TUTORIAL_STEPS.length,
    tabId: progress.tabId,
    aiMode,
    practiceAi,
    /** This AI lesson is watched (no AI connected), not done. */
    watching: !!step.ai && aiMode !== "live",
    phase,
    setPhase,
    start,
    next,
    back,
    skip: exit,
    exit,
    rebindTab,
  };
}

export type Tutorial = ReturnType<typeof useTutorial>;
