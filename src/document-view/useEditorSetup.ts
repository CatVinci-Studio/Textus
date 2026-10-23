import { useRef, useState } from "react";
import { useDocumentReporting, useEditorFlush } from "./useDocumentReporting";
import { useTextusEditor } from "./useTextusEditor";
import { useAiNotice } from "./useAiNotice";
import { useQuickAskDecorations } from "./useQuickAskDecorations";
import { useSettingsRedraw } from "./useSettingsRedraw";
import { useImageNameRequest } from "../editor/images/useImageNameRequest";
import { useEditorRunner } from "../editor/useEditorRunner";
import { useEditorClipboard } from "../editor/useEditorClipboard";
import { useAiActions } from "../ai/writing/useAiActions";
import { useInlineChat } from "../ai/chat/quick-ask/useInlineChat";
import type { Settings } from "../settings/SettingsContext";
import type { Strings } from "../i18n/strings";
import type { TourAi } from "../utils/events";
import { useLatest } from "../utils/hooks/useLatest";

/**
 * One tab's editor itself (MilkdownEditor): the plugin chain, built once
 * and reading live values through refs; the runner every action goes
 * through; what the document reports to its tab; the clipboard; the AI
 * notice; completion and the grammar check; Quick Ask's state.
 */
export function useEditorSetup({
  tabId,
  filePath,
  docTitle,
  initialValue,
  onChange,
  isActive,
  tour,
  settings,
  t,
  phone,
}: {
  tabId: string;
  filePath: string | null;
  docTitle: string;
  initialValue: string;
  onChange: (markdown: string) => void;
  isActive: boolean;
  tour: TourAi | null;
  settings: Settings;
  t: Strings;
  phone: boolean;
}) {
  const { imageNameRequest, requestImageName, closeImageNameDialog } =
    useImageNameRequest();
  // The Quick Ask zone widget's DOM container (quick-ask-widget-plugin) -
  // null whenever no widget is in the document. InlineChat portals into it,
  // so the panel's actual pixels sit wherever ProseMirror placed the
  // decoration (in the document flow, pushing content below it down).
  const [quickAskEl, setQuickAskEl] = useState<HTMLElement | null>(null);

  // The editor plugin chain (useTextusEditor) is only built once, so
  // plugins read these refs to see live settings instead of the value
  // captured at construction time.
  const settingsRef = useLatest(settings);
  const filePathRef = useLatest(filePath);
  const docTitleRef = useLatest(docTitle);
  const isActiveRef = useLatest(isActive);
  const tourRef = useLatest(tour);
  const tRef = useLatest(t);
  const reporting = useDocumentReporting(initialValue, onChange);
  // Set by useEditorPopups (the grammar card); read through a ref here.
  const grammarCaretRef = useRef<() => void>(() => {});

  const {
    pendingEditActionsRef,
    onSelectionChangeRef,
    noMarginRef,
    reviewNotesRef,
  } = useTextusEditor({
    initialValue,
    reporting,
    settingsRef,
    filePathRef,
    tourRef,
    tRef,
    setQuickAskEl,
    requestImageName,
  });

  const run = useEditorRunner();
  const clipboard = useEditorClipboard(run);
  useEditorFlush(tabId, run, reporting);

  const notice = useAiNotice();

  const { triggerCompletion, triggerGrammarCheck } = useAiActions(
    run,
    () => settingsRef.current,
    () => tRef.current,
    notice.showAiNotice,
    () => filePathRef.current,
  );
  const inlineChat = useInlineChat(run);
  useQuickAskDecorations(run, inlineChat, phone);
  useSettingsRedraw(run, settings);

  return {
    run,
    reporting,
    clipboard,
    notice,
    triggerCompletion,
    triggerGrammarCheck,
    inlineChat,
    quickAskEl,
    imageName: { imageNameRequest, requestImageName, closeImageNameDialog },
    settingsRef,
    filePathRef,
    docTitleRef,
    isActiveRef,
    grammarCaretRef,
    pendingEditActionsRef,
    onSelectionChangeRef,
    noMarginRef,
    reviewNotesRef,
  };
}

export type EditorSetup = ReturnType<typeof useEditorSetup>;
