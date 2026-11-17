import { useCallback, useRef, useState } from "react";
import { useDocumentReporting, useEditorFlush } from "./useDocumentReporting";
import { useTextusEditor } from "./useTextusEditor";
import { useAiNotice } from "./useAiNotice";
import { useQuickAskDecorations } from "./useQuickAskDecorations";
import { useSettingsRedraw } from "./useSettingsRedraw";
import { useImageNameRequest } from "../editor/images/useImageNameRequest";
import { useEditorRunner, type EditorRunner } from "../editor/useEditorRunner";
import { useEditorClipboard } from "../editor/clipboard/useEditorClipboard";
import { useAiActions } from "../ai/writing/useAiActions";
import { useInlineChat } from "../ai/chat/quick-ask/useInlineChat";
import type { Settings } from "../prefs/SettingsContext";
import type { Strings } from "../i18n/strings";
import type { TourAi } from "../utils/events";
import { useLatest } from "../utils/hooks/useLatest";
import { useEditorReadOnly } from "./useEditorReadOnly";

type Live<T> = { readonly current: T };

/** What the editor's plugins read live: the chain is built once, so they
 *  read these through refs. */
function useLiveRefs(now: {
  settings: Settings;
  filePath: string | null;
  docTitle: string;
  isActive: boolean;
  tour: TourAi | null;
  t: Strings;
}) {
  const settingsRef = useLatest(now.settings);
  const filePathRef = useLatest(now.filePath);
  const docTitleRef = useLatest(now.docTitle);
  const isActiveRef = useLatest(now.isActive);
  const tourRef = useLatest(now.tour);
  const tRef = useLatest(now.t);
  return { settingsRef, filePathRef, docTitleRef, isActiveRef, tourRef, tRef };
}

/** What runs commands in the editor, its clipboard, and the flush that
 *  hands its last edit to the tab. */
function useRunner(
  tabId: string,
  reporting: ReturnType<typeof useDocumentReporting>,
  filePathRef: Live<string | null>,
) {
  const run = useEditorRunner();
  const clipboard = useEditorClipboard(run);
  useEditorFlush(tabId, run, reporting, filePathRef);
  return { run, clipboard };
}

/** The AI's notice line, which also says why a read-only document
 *  refused an edit. */
function useNoticeAndReadOnly(
  run: EditorRunner,
  readOnly: boolean,
  tRef: Live<Strings>,
) {
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
  return notice;
}

/** The AI in the editor: completion and grammar on their keys, Quick Ask
 *  in the text, and a redraw as its settings change. */
function useAiInEditor({
  run,
  settings,
  settingsRef,
  tRef,
  filePathRef,
  showAiNotice,
  phone,
}: {
  run: EditorRunner;
  settings: Settings;
  settingsRef: Live<Settings>;
  tRef: Live<Strings>;
  filePathRef: Live<string | null>;
  showAiNotice: ReturnType<typeof useAiNotice>["showAiNotice"];
  phone: boolean;
}) {
  const { triggerCompletion, triggerGrammarCheck } = useAiActions(
    run,
    () => settingsRef.current,
    () => tRef.current,
    showAiNotice,
    () => filePathRef.current,
  );
  const inlineChat = useInlineChat(run);
  useQuickAskDecorations(run, inlineChat, phone);
  useSettingsRedraw(run, settings);
  return { triggerCompletion, triggerGrammarCheck, inlineChat };
}

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
  const { settingsRef, filePathRef, docTitleRef, isActiveRef, tourRef, tRef } =
    useLiveRefs({ settings, filePath, docTitle, isActive, tour, t });
  const reporting = useDocumentReporting(initialValue, onChange);
  // Set by useEditorPopups; read through a ref here.
  const grammarCaretRef = useRef<() => void>(() => {});

  const {
    pendingEditActionsRef,
    onSelectionChangeRef,
    noMarginRef,
    reviewNotesRef,
  } = useTextusEditor({
    tabId,
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

  const { run, clipboard } = useRunner(tabId, reporting, filePathRef);
  const notice = useNoticeAndReadOnly(run, readOnly, tRef);
  const { triggerCompletion, triggerGrammarCheck, inlineChat } = useAiInEditor({
    run,
    settings,
    settingsRef,
    tRef,
    filePathRef,
    showAiNotice: notice.showAiNotice,
    phone,
  });

  return {
    tabId,
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
