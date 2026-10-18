import { useCallback, useEffect, useRef } from "react";
import { makeBlankTab } from "../document/doc-tabs";
import { storage } from "../platform/ipc";
import { useLevisImportOffer } from "../settings/levis-import";
import type { Settings } from "../settings/SettingsContext";
import { MODES_PART } from "../onboarding/tutorial-evaluation";
import { practiceDiary, withPracticeDiary } from "../onboarding/practice-diary";
import { stepIndexOf } from "../onboarding/tutorial-steps";
import type { Tutorial } from "../onboarding/useTutorial";
import type { AgentPanelTab } from "../ai/chat/panel/AgentPanelView";
import type { Lang, Strings } from "../i18n/strings";
import type { PanelMode } from "./useSidePanels";
import type { TabState } from "./useTabState";

/**
 * How the first-run surfaces (the Levis import offer, the language
 * welcome, the onboarding tour) hook into this window's tabs and panels.
 * Pulled out of App.tsx, which renders the surfaces themselves.
 */

// Module-scoped, NOT a ref: React StrictMode (dev builds) runs mount effects
// twice on the same component, which would otherwise steal a tab meant for
// a different recovery pass (symptom: one window gets the wrong tab,
// another goes blank). Module state survives the StrictMode remount;
// separate windows are separate webviews with their own module instance, so
// each window still recovers its practice tab at most once. (The startup
// drain effect - OS-open paths, recovered drafts, etc. - has its own analogous
// guard; see startup-restore.ts's `drained`.)
let tutorialTabRecoveryDone = false;

/** A Levis installation on this computer is offered once, before the
 *  language welcome (its import brings the language already chosen). */
export function useLevisOffer(opts: {
  t: Strings;
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  exitTutorial: () => void;
}): { pending: boolean } {
  const { t, settings, setSettings, exitTutorial } = opts;
  const markLevisOffered = useCallback(
    () => setSettings({ levisImportOffered: true }),
    [setSettings],
  );
  return useLevisImportOffer(
    t,
    settings.language,
    settings.levisImportOffered,
    markLevisOffered,
    (items) => {
      // The first-launch guide started before the offer was answered; a
      // Levis user who had already been through it there doesn't get it
      // again (Levis's onboardingShown came over with its settings).
      if (!items.includes("settings")) return;
      void storage.settingsGet().then(({ value }) => {
        if (value.onboardingShown === true) exitTutorial();
      });
    },
  );
}

/** The tour's practice tab, and starting the tour on it. */
export function usePracticeTab(
  tabState: TabState,
  startTutorial: (tabId: string) => void,
) {
  const { tabsRef, setTabs, activeTabId, setActiveTabId } = tabState;

  // Picks the tour's practice tab WITHOUT opening anything new when it can
  // be avoided: the active tab is reused whenever it's an untouched draft
  // (the first-run case, and usually the Help-menu case too); only when the
  // user is mid-document does a blank tab get appended - typing demos must
  // never land in real content.
  const claimPracticeTab = useCallback((): string => {
    const active = tabsRef.current.find((tb) => tb.id === activeTabId);
    if (active && !active.path && !active.helpDoc && active.content === "")
      return active.id;
    const blank = makeBlankTab();
    setTabs((prev) => [...prev, blank]);
    setActiveTabId(blank.id);
    return blank.id;
  }, [activeTabId, tabsRef, setTabs, setActiveTabId]);

  // Starts the onboarding tour - a layer over THIS window (TutorialOverlay),
  // never a separate window or panel. Used by the Help menu item, the
  // no-window pending-help drain, and the fresh-install path alike. Re-arms
  // coach marks too, so relaunching the tour from Help also brings back the
  // "try this" bubbles it would have shown the first time.
  const startWelcomeTutorial = useCallback(() => {
    startTutorial(claimPracticeTab());
  }, [startTutorial, claimPracticeTab]);

  return { claimPracticeTab, startWelcomeTutorial };
}

/**
 * A tutorial left active across a relaunch (app quit mid-tour) has its
 * practice tab gone - it's a pathless draft, never part of session
 * restore (see useSessionPaths) - so its tabId no longer matches anything
 * and the tutorial's orchestration would sit there reacting to nothing
 * forever. Rebind it to a live practice tab (reusing the startup blank tab
 * - see claimPracticeTab) at the same step instead of losing the run.
 */
export function useTutorialTabRecovery(
  tutorial: Tutorial,
  tabState: TabState,
  claimPracticeTab: () => string,
): void {
  const { tabsRef } = tabState;
  useEffect(() => {
    if (tutorialTabRecoveryDone || !tutorial.active) return;
    tutorialTabRecoveryDone = true;
    if (tabsRef.current.some((tab) => tab.id === tutorial.tabId)) return;
    tutorial.rebindTab(claimPracticeTab());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

const FIRST_DIARY_STEP = stepIndexOf("blocks");

/**
 * The practice diary (onboarding/practice-diary.ts) in the tour's tab from
 * the second writing lesson on, under whatever the learner wrote in the
 * first. Checked on every step, so a tour resumed after a relaunch - on a
 * new, empty practice tab - gets it back. Each step also grades the text
 * as it stands: a table made a lesson early counts on arrival.
 */
export function usePracticeDiary(opts: {
  tutorial: Tutorial;
  tabState: TabState;
  language: Lang;
  evaluate: (tabId: string, markdown: string) => void;
}): void {
  const { tutorial, tabState, language, evaluate } = opts;
  const { liveTabs, updateTab } = tabState;
  const { active, tabId, stepIndex } = tutorial;
  useEffect(() => {
    if (!active || !tabId) return;
    const tab = liveTabs().find((tb) => tb.id === tabId);
    if (!tab || tab.path || tab.helpDoc) return;
    let content = tab.content;
    if (stepIndex >= FIRST_DIARY_STEP) {
      content = withPracticeDiary(content, practiceDiary(language));
      if (content !== tab.content)
        updateTab(tab.id, { content, reloadKey: tab.reloadKey + 1 });
    }
    evaluate(tab.id, content);
    // The language is read, not followed: changing it mid-tour must not
    // add a second diary (withPracticeDiary knows both anyway).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tabId, stepIndex, liveTabs, updateTab, evaluate]);
}

/**
 * The tour's lessons about the window rather than the text: a writing mode
 * and a theme tried, the sidebar's outline looked at, the AI panel opened
 * and its Memory tab shown. Returns whether the sidebar lesson is on, for
 * the sidebar's spotlight.
 */
export function useWindowLessons(opts: {
  tutorial: Tutorial;
  languageChosen: boolean;
  panelOpen: boolean;
  panelMode: PanelMode;
  agentPanelOpen: boolean;
  agentPanelTab: AgentPanelTab;
  /** Which writing mode is on, as one string. */
  writingMode: string;
  /** Which theme shows, as one string. */
  look: string;
}): boolean {
  const { tutorial, languageChosen, panelOpen, panelMode } = opts;
  const { agentPanelOpen, agentPanelTab, writingMode, look } = opts;
  const lesson = tutorial.active && languageChosen ? tutorial.step.id : null;
  const setPhase = tutorial.setPhase;

  // Against how things were when the lesson began: what changed since.
  const before = useRef<{ writingMode: string; look: string } | null>(null);
  useEffect(() => {
    if (lesson !== "modes-themes") {
      before.current = null;
      return;
    }
    before.current ??= { writingMode, look };
    const parts =
      (writingMode !== before.current.writingMode ? MODES_PART.mode : 0) |
      (look !== before.current.look ? MODES_PART.theme : 0);
    if (parts) setPhase((phase) => phase | parts);
  }, [lesson, writingMode, look, setPhase]);

  useEffect(() => {
    if (
      (lesson === "sidebar-export" && panelOpen && panelMode === "outline") ||
      (lesson === "ai-panel" && agentPanelOpen) ||
      (lesson === "memory" && agentPanelOpen && agentPanelTab === "memory")
    )
      setPhase((phase) => Math.max(phase, 1));
  }, [lesson, panelOpen, panelMode, agentPanelOpen, agentPanelTab, setPhase]);

  return lesson === "sidebar-export";
}
