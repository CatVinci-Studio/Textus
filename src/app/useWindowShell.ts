import { useState } from "react";
import { useSettingsOpening } from "./SettingsLayer";
import { useTutorial } from "../onboarding/useTutorial";
import { useTutorialDocumentEvaluation } from "../onboarding/useTutorialDocumentEvaluation";
import { useAppUpdate } from "./useAppUpdate";
import { useZoom } from "./useZoom";
import { useDraftAutosave } from "../document/draft-autosave";
import { useTextusAi, useTextusAiResume } from "../ai/TextusAiSwitch";
import { useTabState } from "./tabs/useTabState";
import { useSidePanels } from "./useSidePanels";
import { useWordImported } from "./AppNotices";
import type { PendingClose } from "./close-flow";
import type { Settings, useSettings } from "../settings/SettingsContext";

/**
 * A window's frame (App.tsx): its tabs, the close prompt's state, Textus
 * AI's switch, the side panels, Settings' opening, updates, zoom, the
 * tour, and the drafts kept for unsaved tabs.
 */
export function useWindowShell({
  settings,
  setSettings,
}: {
  settings: Settings;
  setSettings: ReturnType<typeof useSettings>["setSettings"];
}) {
  const tabState = useTabState();
  // The one save/discard/cancel prompt (close-flow.ts's PendingClose).
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const textusAi = useTextusAi();
  useTextusAiResume();
  const panels = useSidePanels(textusAi.on);
  const settingsOpening = useSettingsOpening();
  const appUpdate = useAppUpdate(settings.updateChannel);
  useZoom(settings.zoom, (zoom) => setSettings({ zoom }));
  const tutorial = useTutorial(textusAi.on);
  const evaluateTutorialDocumentChange = useTutorialDocumentEvaluation(
    tutorial,
    settings.language,
  );
  const cancelDraftFlushes = useDraftAutosave(
    tabState.tabs,
    settings.enableDraftRecovery,
  );
  const [draftsRestoredCount, setDraftsRestoredCount] = useState(0);
  const wordImported = useWordImported();
  return {
    tabState,
    pendingClose,
    setPendingClose,
    textusAi,
    panels,
    settingsOpening,
    appUpdate,
    tutorial,
    evaluateTutorialDocumentChange,
    cancelDraftFlushes,
    draftsRestoredCount,
    setDraftsRestoredCount,
    wordImported,
  };
}

export type WindowShell = ReturnType<typeof useWindowShell>;
