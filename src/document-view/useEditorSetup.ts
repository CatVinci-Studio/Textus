import { useCallback, useRef, useState } from "react";
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
import { useEditorReadOnly } from "./useEditorReadOnly";

/**
 * One tab's editor itself: the plugin chain, the runner every action goes
 * through, document reporting, the clipboard, completion, grammar and Quick
 * Ask's state.
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
  readOnly,
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
  readOnly: boolean;
}) {
  const { imageNameRequest, requestImageName, closeImageNameDialog } =
    useImageNameRequest();
  // The Quick Ask zone widget's container, null when none is in the
  // document. InlineChat portals into it, in the document flow.
  const [quickAskEl, setQuickAskEl] = useState<HTMLElement | null>(null);

  // The chain is built once, so plugins read live settings through refs.
  const settingsRef = useLatest(settings);
  const filePathRef = useLatest(filePath);
  const docTitleRef = useLatest(docTitle);
  const isActiveRef = useLatest(isActive);
  const tourRef = useLatest(tour);
  const tRef = useLatest(t);
  const reporting = useDocumentReporting(initialValue, onChange);
  // Set by useEditorPopups; read through a ref here.
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
    isActiveRef,
    tourRef,
    tRef,
    setQuickAskEl,
    requestImageName,
  });

  const run = useEditorRunner();
  const clipboard = useEditorClipboard(run);
  useEditorFlush(tabId, run, reporting);

  const notice = useAiNotice();
  const { showAiNotice } = notice;
  useEditorReadOnly(
    run,
    readOnly,
    useCallback(
      () => showAiNotice(tRef.current.readOnlyRefused),
      [showAiNotice, tRef],
    ),
  );

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
