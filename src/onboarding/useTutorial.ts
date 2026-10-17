import { useCallback, useEffect, useState, type SetStateAction } from "react";
import { resolveSavedStepIndex, TUTORIAL_STEPS } from "./tutorial-steps";
import type { TutorialStepId } from "./tutorial-steps";
import { getUiState, setUiState } from "../storage/ui-state";
import {
  AI_MESSAGE_SENT_EVENT,
  TUTORIAL_AGENT_PROPOSAL_EVENT,
} from "../utils/events";

interface TutorialProgress {
  active: boolean;
  stepIndex: number;
  /** The practice tab this run is bound to - orchestration only reacts to
   *  edits in that tab, so the tour never reads (or looks like it's
   *  grading) a document the user opened for real work. */
  tabId: string | null;
}

const IDLE_PROGRESS: TutorialProgress = {
  active: false,
  stepIndex: 0,
  tabId: null,
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
      stepIndex: resolveSavedStepIndex(parsed),
      tabId: typeof parsed.tabId === "string" ? parsed.tabId : null,
    };
  } catch {
    return IDLE_PROGRESS;
  }
}

/**
 * The onboarding tour's state machine. `stepIndex` is persisted (UI state,
 * storage/ui-state.ts) so quitting mid-tour resumes at the same step on
 * relaunch;
 * `phase` is the current step's internal progress and deliberately is NOT
 * persisted - a resumed step restarts from its beginning, which is always
 * safe because phases only ever gate hint text and mock triggers. Every
 * phase advance is driven by something the user actually did - typing,
 * sending a chat message - never a scripted demo:
 *  - markdown:   a bit mask tracks all seven Markdown exercises
 *  - completion: 0 waiting for the target text → 1 ghost shown → 2 accepted
 *  - grammar:    0 waiting → 1 issue shown → 2 correction applied
 *  - agent chat: 0 waiting for a message → 1 sent (mock reply on its way)
 *  - agent edit: 0 waiting for text → 1 ready to ask → 2 proposal shown →
 *                3 accepted
 * The step-specific orchestration that ADVANCES phases lives where its
 * inputs are: doc-text reactions in App.tsx's handleChange, the window
 * event below here.
 */
export function useTutorial() {
  const [progress, setProgress] = useState<TutorialProgress>(loadProgress);
  // Keep each lesson's completion while moving Back/Continue so learners can
  // freely revisit cards without redoing exercises. This remains
  // session-only: after an app relaunch, the current lesson restarts safely.
  const [phases, setPhases] = useState<Partial<Record<TutorialStepId, number>>>(
    {},
  );

  // The step's id is saved beside its index and is what a resume reads, so
  // a step added to the list later can't shift a saved run onto the wrong
  // lesson (resolveSavedStepIndex).
  useEffect(() => {
    setUiState("tutorialProgress", {
      ...progress,
      stepId: TUTORIAL_STEPS[progress.stepIndex].id,
    });
  }, [progress]);

  const start = useCallback((tabId: string) => {
    setPhases({});
    setProgress({ active: true, stepIndex: 0, tabId });
  }, []);

  const next = useCallback(() => {
    setProgress((p) => {
      if (!p.active) return p;
      if (p.stepIndex + 1 >= TUTORIAL_STEPS.length) return IDLE_PROGRESS;
      return { ...p, stepIndex: p.stepIndex + 1 };
    });
  }, []);

  const back = useCallback(() => {
    setProgress((p) =>
      p.active ? { ...p, stepIndex: Math.max(0, p.stepIndex - 1) } : p,
    );
  }, []);

  const exit = useCallback(() => setProgress(IDLE_PROGRESS), []);

  const step = TUTORIAL_STEPS[progress.stepIndex];
  const active = progress.active;
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

  // A chat message actually went out (InlineChat's send) - the mock reply
  // is on its way, the step is done.
  useEffect(() => {
    if (!active || step.id !== "agentChat") return;
    const handler = () => setPhase((p) => Math.max(p, 1));
    window.addEventListener(AI_MESSAGE_SENT_EVENT, handler);
    return () => window.removeEventListener(AI_MESSAGE_SENT_EVENT, handler);
  }, [active, step.id, setPhase]);

  // The editing lesson advances only once the mocked Agent reply has been
  // parsed into a visible propose_edit preview. Applying it is detected from
  // the resulting document text by useTutorialDocumentEvaluation.
  useEffect(() => {
    if (!active || step.id !== "agentEdit") return;
    const handler = () => setPhase((p) => Math.max(p, 2));
    window.addEventListener(TUTORIAL_AGENT_PROPOSAL_EVENT, handler);
    return () =>
      window.removeEventListener(TUTORIAL_AGENT_PROPOSAL_EVENT, handler);
  }, [active, step.id, setPhase]);

  // Rebinds an in-progress tutorial to a different tab id, keeping the
  // current step - used when the practice tab didn't survive a relaunch
  // (see App.tsx: it's a pathless draft, so it's never part of session
  // restore) so the tutorial resumes on a live tab instead of pointing at
  // one that no longer exists.
  const rebindTab = useCallback((tabId: string) => {
    setProgress((p) => (p.active ? { ...p, tabId } : p));
  }, []);

  return {
    active,
    stepIndex: progress.stepIndex,
    step,
    totalSteps: TUTORIAL_STEPS.length,
    tabId: progress.tabId,
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
