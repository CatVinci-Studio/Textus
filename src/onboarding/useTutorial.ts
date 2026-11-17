import { useCallback, useEffect, useState } from "react";
import {
  resolveSavedStep,
  stepIndexOf,
  TUTORIAL_STEPS,
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
  /** The practice tab this run is bound to. Only its edits count, so the tour
   *  never grades a document the user opened for real work. */
  tabId: string | null;
}

const IDLE: TutorialProgress = { active: false, stepIndex: 0, tabId: null };

function loadProgress(): TutorialProgress {
  try {
    const saved = getUiState("tutorialProgress") as Record<
      string,
      unknown
    > | null;
    if (!saved || typeof saved !== "object" || Array.isArray(saved))
      return IDLE;
    return {
      active: saved.active === true,
      stepIndex: resolveSavedStep(saved),
      tabId: typeof saved.tabId === "string" ? saved.tabId : null,
    };
  } catch {
    return IDLE;
  }
}

/** The tour's state: its step and practice tab, kept across relaunches by
 *  the step's id, so a step added later can't shift a saved run. */
/** The tour's progress, kept across launches. */
function useKeptProgress() {
  const [progress, setProgress] = useState<TutorialProgress>(loadProgress);
  useEffect(() => {
    setUiState("tutorialProgress", {
      ...progress,
      stepId: TUTORIAL_STEPS[progress.stepIndex].id,
    });
  }, [progress]);
  return [progress, setProgress] as const;
}

/** Next, back and to a step by id, through `go`. */
function useStepMoves(
  go: (to: (p: TutorialProgress) => number | null) => void,
) {
  const next = useCallback(() => go((p) => p.stepIndex + 1), [go]);
  const back = useCallback(() => go((p) => Math.max(0, p.stepIndex - 1)), [go]);
  const goTo = useCallback(
    (id: TutorialStepId) => go(() => stepIndexOf(id)),
    [go],
  );
  return { next, back, goTo };
}

export function useTutorial(
  /** Textus AI's switch. */
  aiOn = true,
) {
  const [progress, setProgress] = useKeptProgress();
  // The stop lit within the step (its `stops`), from the first each time.
  const [stop, setStop] = useState(0);

  const go = useCallback(
    (to: (p: TutorialProgress) => number | null) => {
      setStop(0);
      setProgress((p) => {
        if (!p.active) return p;
        const at = to(p);
        return at === null || at >= TUTORIAL_STEPS.length
          ? IDLE
          : { ...p, stepIndex: at };
      });
    },
    [setProgress],
  );

  const start = useCallback(
    (tabId: string) => {
      setStop(0);
      setProgress({ active: true, stepIndex: 0, tabId });
    },
    [setProgress],
  );
  const { next, back, goTo } = useStepMoves(go);
  const exit = useCallback(() => {
    setStop(0);
    setProgress(IDLE);
  }, [setProgress]);

  const step = TUTORIAL_STEPS[progress.stepIndex];
  const { active } = progress;

  // An AI revision decided in the practice tab ends the step waiting on it.
  useEffect(() => {
    if (!active || step.until !== "revision-decided") return;
    const handler = (e: Event) => {
      if ((e as CustomEvent<TourSignal>).detail === "revision-decided") next();
    };
    window.addEventListener(TOUR_SIGNAL_EVENT, handler);
    return () => window.removeEventListener(TOUR_SIGNAL_EVENT, handler);
  }, [active, step.until, next]);

  // Rebinds the tour to a new tab, keeping the step: the practice tab is a
  // pathless draft, so it never survives a relaunch.
  const rebindTab = useCallback(
    (tabId: string) => {
      setProgress((p) => (p.active ? { ...p, tabId } : p));
    },
    [setProgress],
  );

  /** The practice tab's AI: the real thing on the step that uses it, muted
   *  everywhere else in the tour. */
  const practiceAi: TourAi = active && aiOn && step.live ? "live" : "muted";

  return {
    active,
    stepIndex: progress.stepIndex,
    step,
    stop,
    setStop,
    totalSteps: TUTORIAL_STEPS.length,
    tabId: progress.tabId,
    practiceAi,
    /** The AI panel's mode this step sets, when it needs one. */
    agentMode: active ? (step.agentMode ?? null) : null,
    start,
    next,
    back,
    goTo,
    exit,
    rebindTab,
  };
}

export type Tutorial = ReturnType<typeof useTutorial>;
