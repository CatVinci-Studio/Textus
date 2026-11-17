import { useState } from "react";
import { useSettingsOpening } from "./SettingsLayer";
import { useTutorial } from "../onboarding/useTutorial";
import { useTutorialDocumentEvaluation } from "../onboarding/useTutorialDocumentEvaluation";
import { useUpdateChecks } from "./app-update";
import { useZoom } from "./useZoom";
import { useDraftAutosave } from "../document/draft-autosave";
import { useTextusAi, useTextusAiResume } from "../ai/TextusAiSwitch";
import { useTabState } from "./tabs/useTabState";
import { useSidePanels } from "./frame/useSidePanels";
import { useWordImported } from "./AppNotices";
import type { PendingClose } from "./close-flow";
import { useKeepTabs } from "../document/reload-tabs";
import type { Settings, useSettings } from "../prefs/SettingsContext";

/** Textus AI's switch (picked up again after a restart) and the side
 *  panels, which show its tab while it is on. */
function useAiAndPanels(activeTabId: string) {
  const textusAi = useTextusAi();
  useTextusAiResume();
  const panels = useSidePanels(textusAi.on, activeTabId);
  return { textusAi, panels };
}

/** Update checks on the chosen channel, and the window's zoom. */
function useUpdatesAndZoom(
  settings: Settings,
  setSettings: ReturnType<typeof useSettings>["setSettings"],
) {
  useUpdateChecks(settings.updateChannel);
  useZoom(
    settings.zoom,
    (zoom) => setSettings({ zoom }),
    settings.zoomTogether,
  );
}

/** The tour, and what it watches the practice document for. */
function useTutorialTracking(aiOn: boolean) {
  const tutorial = useTutorial(aiOn);
  const evaluateTutorialDocumentChange =
    useTutorialDocumentEvaluation(tutorial);
  return { tutorial, evaluateTutorialDocumentChange };
}

/** Drafts kept as they are typed and the open tabs kept for the next
 *  start, while draft recovery is on; how many came back this start. */
function useDraftKeeping(
  tabState: ReturnType<typeof useTabState>,
  enabled: boolean,
) {
  const cancelDraftFlushes = useDraftAutosave(tabState.tabs, enabled);
  useKeepTabs(tabState.tabs, tabState.activeTabId, enabled, tabState.liveTabs);
  const [draftsRestoredCount, setDraftsRestoredCount] = useState(0);
  return { cancelDraftFlushes, draftsRestoredCount, setDraftsRestoredCount };
}

/**
 * A window's frame: tabs, the close prompt, Textus AI's switch, side panels,
 * Settings, updates, zoom, the tour and draft recovery.
 */
export function useWindowShell({
  settings,
  setSettings,
}: {
  settings: Settings;
  setSettings: ReturnType<typeof useSettings>["setSettings"];
}) {
  const tabState = useTabState();
  // The one save/discard/cancel prompt.
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const { textusAi, panels } = useAiAndPanels(tabState.activeTabId);
  const settingsOpening = useSettingsOpening(tabState);
  useUpdatesAndZoom(settings, setSettings);
  const { tutorial, evaluateTutorialDocumentChange } = useTutorialTracking(
    textusAi.on,
  );
  const { cancelDraftFlushes, draftsRestoredCount, setDraftsRestoredCount } =
    useDraftKeeping(tabState, settings.enableDraftRecovery);
  const wordImported = useWordImported();
  return {
    tabState,
    pendingClose,
    setPendingClose,
    textusAi,
    panels,
    settingsOpening,
    tutorial,
    evaluateTutorialDocumentChange,
    cancelDraftFlushes,
    draftsRestoredCount,
    setDraftsRestoredCount,
    wordImported,
  };
}

export type WindowShell = ReturnType<typeof useWindowShell>;
