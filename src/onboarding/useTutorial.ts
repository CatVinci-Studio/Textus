import { useCallback, useEffect, useState, type SetStateAction } from "react";
import { useLatest } from "../utils/hooks/useLatest";
import {
  resolveSavedProgress,
  stepIndexOf,
  TUTORIAL_STEPS,
  type TutorialAiMode,
  type TutorialStepId,
} from "./tutorial-steps";
import { LESSON_DONE } from "./tutorial-evaluation";
import { getUiState, setUiState } from "../storage/ui-state";
import {
  TOUR_SIGNAL_EVENT,
  type TourAi,
  type TourSignal,
} from "../utils/events";

interface TutorialProgress {
  active: boolean;
  stepIndex: number;
  /** The practice tab this run is bound to. Only its edits count, so the tour
   *  never grades a document the user opened for real work. */
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
const FIRST_AI = stepIndexOf("write");

/** The lesson each signal from the practice tab completes. */
const SIGNAL_LESSONS: Record<TourSignal, TutorialStepId> = {
  "completion-accepted": "continuation",
  "revision-decided": "write",
  "palette-command": "palette",
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

/** The onboarding tour's state machine. Step, practice tab and AI mode persist
 *  across relaunches; `phase` does not, as restarting a lesson is safe. Every
 *  phase advance is something the learner actually did. */
export function useTutorial(
  /** Textus AI's switch. */
  aiOn = true,
) {
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
      const lesson = SIGNAL_LESSONS[(e as CustomEvent<TourSignal>).detail];
      if (lesson === step.id) setPhase((p) => p | LESSON_DONE);
    };
    window.addEventListener(TOUR_SIGNAL_EVENT, handler);
    return () => window.removeEventListener(TOUR_SIGNAL_EVENT, handler);
  }, [active, step.id, setPhase]);

  // Rebinds the tour to a new tab, keeping the step: the practice tab is a
  // pathless draft, so it never survives a relaunch.
  const rebindTab = useCallback((tabId: string) => {
    setProgress((p) => (p.active ? { ...p, tabId } : p));
  }, []);

  /** The practice tab's AI: live from the first AI lesson for a learner who
   *  connected one and has Textus AI on, muted everywhere else in the tour. */
  const live = aiMode === "live" && aiOn;
  const practiceAi: TourAi =
    live && progress.stepIndex >= FIRST_AI ? "live" : "muted";

  return {
    active,
    stepIndex: progress.stepIndex,
    step,
    totalSteps: TUTORIAL_STEPS.length,
    tabId: progress.tabId,
    aiMode,
    practiceAi,
    /** The AI panel's mode this lesson sets, when it needs one. */
    agentMode: active ? (step.agentMode ?? null) : null,
    /** This AI lesson is watched (no AI connected), not done. */
    watching: !!step.ai && !live,
    phase,
    setPhase,
    start,
    next,
    back,
    exit,
    rebindTab,
  };
}

export type Tutorial = ReturnType<typeof useTutorial>;
