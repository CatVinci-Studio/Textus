import { useCallback, useEffect } from "react";
import { useLatest } from "../utils/hooks/useLatest";
import { makeBlankTab, tabIsUntouchedDraft } from "../document/doc-tabs";
import { WRITE_PART } from "../onboarding/tutorial-evaluation";
import { practiceNotes, withPracticeNotes } from "../onboarding/practice-notes";
import { stepIndexOf } from "../onboarding/tutorial-steps";
import type { Tutorial } from "../onboarding/useTutorial";
import type { Lang } from "../i18n/strings";
import type { TabState } from "./tabs/useTabState";

/** How the first-run surfaces hook into this window's tabs and panels. */

// Module-scoped, not a ref: StrictMode runs mount effects twice, which would
// steal a tab meant for another recovery pass. Each window is its own
// webview, so each still recovers at most once.
let tutorialTabRecoveryDone = false;

/** The tour's practice tab, and starting the tour on it. */
export function usePracticeTab(
  tabState: TabState,
  startTutorial: (tabId: string) => void,
) {
  const { tabsRef, setTabs, activeTabId, setActiveTabId } = tabState;

  // Reuses the active tab when it's an untouched draft; otherwise appends a
  // blank one, so typing demos never land in real content.
  const claimPracticeTab = useCallback((): string => {
    const active = tabsRef.current.find((tb) => tb.id === activeTabId);
    if (active && tabIsUntouchedDraft(active)) return active.id;
    const blank = makeBlankTab();
    setTabs((prev) => [...prev, blank]);
    setActiveTabId(blank.id);
    return blank.id;
  }, [activeTabId, tabsRef, setTabs, setActiveTabId]);

  // Starts the tour as a layer over this window, and re-arms the coach
  // marks too.
  const startWelcomeTutorial = useCallback(() => {
    startTutorial(claimPracticeTab());
  }, [startTutorial, claimPracticeTab]);

  return { claimPracticeTab, startWelcomeTutorial };
}

/**
 * A tour left active across a relaunch has lost its practice tab (drafts
 * aren't restored); rebind it to a live one at the same step.
 */
export function useTutorialTabRecovery(
  tutorial: Tutorial,
  tabState: TabState,
  claimPracticeTab: () => string,
): void {
  const { tabsRef } = tabState;
  // Once, at the window's mount, with the tour as it stood then.
  const latest = useLatest({ tutorial, claimPracticeTab });
  useEffect(() => {
    const { tutorial, claimPracticeTab } = latest.current;
    if (tutorialTabRecoveryDone || !tutorial.active) return;
    tutorialTabRecoveryDone = true;
    if (tabsRef.current.some((tab) => tab.id === tutorial.tabId)) return;
    tutorial.rebindTab(claimPracticeTab());
  }, [latest, tabsRef]);
}

// The notes come once the first lesson, typed on an empty page, is done.
const FIRST_NOTES_STEP = stepIndexOf("wysiwyg") + 1;

/**
 * The practice notes in the tour's tab from the second writing lesson on.
 * Checked every step, so a resumed tour gets them back; each step also
 * grades the text as it stands.
 */
export function usePracticeNotes(opts: {
  tutorial: Tutorial;
  tabState: TabState;
  language: Lang;
  evaluate: (tabId: string, markdown: string) => void;
}): void {
  const { tutorial, tabState, language, evaluate } = opts;
  const { liveTabs, updateTab } = tabState;
  const { active, tabId, stepIndex } = tutorial;
  // Read, not followed: a mid-tour language change must not add a second
  // set of notes.
  const languageRef = useLatest(language);
  useEffect(() => {
    if (!active || !tabId) return;
    const tab = liveTabs().find((tb) => tb.id === tabId);
    if (!tab || tab.path || tab.helpDoc) return;
    let content = tab.content;
    if (stepIndex >= FIRST_NOTES_STEP) {
      content = withPracticeNotes(content, practiceNotes(languageRef.current));
      if (content !== tab.content)
        updateTab(tab.id, { content, reloadKey: tab.reloadKey + 1 });
    }
    evaluate(tab.id, content);
  }, [active, tabId, stepIndex, liveTabs, updateTab, evaluate, languageRef]);
}

/** The AI writing lesson's first line: the panel open. */
export function useWriteLesson(opts: {
  tutorial: Tutorial;
  languageChosen: boolean;
  agentPanelOpen: boolean;
}): void {
  const { tutorial, languageChosen, agentPanelOpen } = opts;
  const lesson = tutorial.active && languageChosen ? tutorial.step.id : null;
  const setPhase = tutorial.setPhase;
  useEffect(() => {
    if (lesson === "write" && agentPanelOpen)
      setPhase((phase) => phase | WRITE_PART.panel);
  }, [lesson, agentPanelOpen, setPhase]);
}
