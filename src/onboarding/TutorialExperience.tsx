import { useEffect } from "react";
import { fill } from "../i18n/fill";
import type { Lang, Strings } from "../i18n/strings";
import { links } from "../platform/ipc";
import { useSettings } from "../prefs/SettingsContext";
import { onPluginEvent } from "../plugins/app-bridge";
import { panelsState, type PanelsState } from "../plugins/panels-state";
import { useAiSignedIn } from "../ai/chat/chat-models";
import { TourLayer } from "./TourLayer";
import { withCode } from "./with-code";
import type { TutorialUntil } from "./tutorial-steps";
import type { Tutorial } from "./useTutorial";

/** The panel a step waits on being opened. */
const OPENS: Partial<Record<TutorialUntil, (p: PanelsState) => boolean>> = {
  "sidebar-open": (p) => p.sidebar.open,
  "ai-open": (p) => p.ai.open,
};

/** Moves a step on once the panel it asks for is open, already or later. */
function usePanelStep(tutorial: Tutorial) {
  const opened = tutorial.step.until && OPENS[tutorial.step.until];
  const { next } = tutorial;
  useEffect(() => {
    if (!opened) return;
    if (opened(panelsState())) return next();
    return onPluginEvent("panels", (p) => opened(p) && next());
  }, [opened, next]);
}

/** The AI's steps without an AI to use: on to the end. Signing in moves
 *  the sign-in step on. */
function useAiSteps(tutorial: Tutorial, aiOn: boolean) {
  const signedIn = useAiSignedIn();
  const { step, next, goTo } = tutorial;
  useEffect(() => {
    if (!step.ai) return;
    if (!aiOn || (step.live && signedIn === false)) goTo("done");
    else if (step.until === "signed-in" && signedIn) next();
  }, [step, aiOn, signedIn, next, goTo]);
}

/** The tour's card over the window, for its current step. */
export function TutorialExperience({
  tutorial,
  t,
  language,
  phone,
}: {
  tutorial: Tutorial;
  t: Strings;
  language: Lang;
  /** The phone layout: taps, and a sidebar behind a button. */
  phone: boolean;
}) {
  const { settings } = useSettings();
  usePanelStep(tutorial);
  useAiSteps(tutorial, settings.textusAi);

  const { step, stop, stepIndex, totalSteps } = tutorial;
  const stopAt = step.stops?.[stop];
  const target =
    stopAt?.target ??
    (phone ? step.phoneTarget : undefined) ??
    step.target ??
    null;
  const isLast = stepIndex === totalSteps - 1;
  const lastStop = !step.stops || stop >= step.stops.length - 1;

  // A step asking for something has no Next: doing it moves on. Skipping
  // the sign-in (or the AI) skips the AI's steps with it.
  const skipAi = step.ai && step.until !== "revision-decided";
  const primary = step.until
    ? null
    : {
        label: isLast
          ? t.tutorialFinish
          : stepIndex === 0
            ? t.tutorialStart
            : t.tutorialNext,
        onClick: lastStop ? tutorial.next : () => tutorial.setStop(stop + 1),
      };

  return (
    <TourLayer
      target={target}
      beside={step.beside}
      open={!!step.open}
      phone={phone}
      labelledBy="tour-title"
      onEscape={tutorial.exit}
    >
      <span className="tour-count">
        {fill(t.tutorialStepOfCount, { i: stepIndex + 1, n: totalSteps })}
      </span>
      <h2 id="tour-title" className="tour-title">
        {t[step.titleKey]}
      </h2>
      <p className="tour-body">
        {withCode(t[(phone && step.phoneBodyKey) || step.bodyKey])}
      </p>
      {stopAt && <p className="tour-stop">{withCode(t[stopAt.key])}</p>}
      {step.id === "done" && (
        <div className="tour-links">
          <button
            type="button"
            className="tx-button"
            onClick={() => void links.openTutorialsPage(language)}
          >
            {t.menuHelpTutorials}
          </button>
          <button
            type="button"
            className="tx-button"
            onClick={() => void links.openCommunityPage(language)}
          >
            {t.menuHelpCommunity}
          </button>
        </div>
      )}
      <div className="tour-actions">
        {!isLast && (
          <button type="button" className="tour-link" onClick={tutorial.exit}>
            {t.tutorialSkip}
          </button>
        )}
        <div className="tour-actions-main">
          {step.until && (
            <button
              type="button"
              className="tour-link"
              onClick={skipAi ? () => tutorial.goTo("done") : tutorial.next}
            >
              {skipAi ? t.tutorialConnectSkip : t.tutorialSkipStep}
            </button>
          )}
          {stepIndex > 0 && !isLast && (
            <button type="button" className="tx-button" onClick={tutorial.back}>
              {t.tutorialBack}
            </button>
          )}
          {primary && (
            <button
              type="button"
              className="tx-button primary"
              autoFocus={!target}
              onClick={primary.onClick}
            >
              {primary.label}
            </button>
          )}
        </div>
      </div>
    </TourLayer>
  );
}
