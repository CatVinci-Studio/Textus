import { useSelectionIllustration } from "./useSelectionIllustration";
import { modalDialogOpen } from "../ui/useModalDialog";
import { basename, decodeLocalPath } from "../utils/path";
import { ai } from "../platform/ipc";
import { FolderIcon, ImageFileIcon, OutlineTabIcon } from "../ui/icons";
import type { ComposerMenuItem } from "../ai/chat/ComposerMenu";
import { WritePlayback, useWritePlayback } from "./WritePlayback";
import { useEditorDictationTarget } from "./useEditorDictationTarget";
import {
  type MouseEvent,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { useDocumentWorkspace } from "./useDocumentWorkspace";
import { useWorkspacePersistence } from "./useWorkspacePersistence";
import { useDocumentImages } from "./useDocumentImages";
import { ImageJobsPanel } from "../ai/multimodal/ImageTools";
import { PromptRefiner } from "../ai/multimodal/PromptRefiner";
import { AgentWorkspace } from "../ai/workspace/AgentWorkspace";
import { AutoWriter, type AutoWriterHost } from "../ai/workspace/AutoWriter";
import { ProjectChip } from "../ai/workspace/ProjectChip";
import { SurfaceSwitch } from "../ai/workspace/SurfaceSwitch";
import { formatCombo } from "../utils/shortcuts";
import type { EditProposal } from "../ai/types";
import {
  useProjectMaterial,
  type AutoWriteRequest,
} from "../ai/workspace/useProjectMaterial";
import { proposalsFromTurns } from "../ai/chat/ChatBody";
import {
  findConversation,
  rememberConversationDocument,
} from "../ai/chat/chat-history";
import { useAgentSuggestions } from "../ai/workspace/assist";
import { useAutoTitle } from "./useAutoTitle";
import { FillSlotCard } from "./FillSlotCard";
import {
  FILL_SLOT_EVENT,
  type FillSlotRequest,
} from "../editor/fill-slots/fill-slot-plugin";
import {
  getWindowSurface,
  REWRITE_IMAGE_SRCS_EVENT,
  TOGGLE_SURFACE_EVENT,
  RESTORE_TASK_EVENT,
  pendingTaskRestores,
  type RewriteImageSrcs,
  setTabEngaged,
  setWindowSurface,
} from "../document/doc-tabs";
import { ChatBody } from "../ai/chat/ChatBody";
import { contextMenuTarget, insertTable } from "../editor/editor-menu";
import { useDocumentReporting, useEditorFlush } from "./useDocumentReporting";
import { useTextusEditor } from "./useTextusEditor";
import { useAiNotice } from "./useAiNotice";
import { useQuickAskDecorations } from "./useQuickAskDecorations";
import { useEditorProposals } from "./useEditorProposals";
import { useChatContextBridge } from "./useChatContextBridge";
import { usePanelSelection } from "./usePanelSelection";
import { useQuickAskReview } from "./useQuickAskReview";
import { useQuickAskControls } from "./useQuickAskControls";
import { usePopupDismiss } from "./usePopupDismiss";
import { useEditorWindowEvents } from "./useEditorWindowEvents";
import { useEditorPane, useReviewBar } from "./useReviewBar";
import { EditorContextMenu, type EditorMenuState } from "./EditorContextMenu";
import { EditorAgentPanel } from "./EditorAgentPanel";
import { GrammarSuggestion } from "../ai/writing/GrammarSuggestion";
import { InlineChat } from "../ai/chat/quick-ask/InlineChat";
import { useAgentPanel } from "../ai/chat/panel/agent-panel";
import { chatLabels } from "../ai/chat/chat-labels";
import { usePhoneLayout } from "../ui/usePhoneLayout";
import { InsertTableDialog } from "../editor/tables/InsertTableDialog";
import { ImageNameDialog } from "../editor/images/ImageNameDialog";
import { useImageNameRequest } from "../editor/images/useImageNameRequest";
import { FindReplaceBar } from "../editor/find/FindReplaceBar";
import { useFindReplace } from "../editor/find/useFindReplace";
import { useModeSwitchCaret } from "../editor/modes/useModeSwitchCaret";
import { useFocusModeRefresh } from "../editor/modes/useFocusModeRefresh";
import { Presence, PresenceDiv } from "../ui/usePresence";
import { useEditorRunner } from "../editor/useEditorRunner";
import { useEditorClipboard } from "../editor/useEditorClipboard";
import { useAiActions } from "../ai/writing/useAiActions";
import { useInlineChat } from "../ai/chat/quick-ask/useInlineChat";
import { ReviewBar } from "../ai/revision/ReviewBar";
import { revisionDisplayName } from "../ai/revision/revision-display";
import { ReviewMargin } from "../ai/margin/ReviewMargin";
import { OpenReviewNote } from "../ai/margin/OpenReviewNote";
import { useReviewNotes } from "../ai/margin/useReviewNotes";
import { useGrammarPopover } from "../ai/writing/useGrammarPopover";
import { useSettings } from "../settings/SettingsContext";
import { useLatest } from "../utils/hooks/useLatest";
import { Milkdown } from "@milkdown/react";
import "@milkdown/kit/prose/view/style/prosemirror.css";
import "katex/dist/katex.min.css";
import "../theme/content-base.css";
import "../editor/milkdown-theme.css";
import "../theme/content-themes.css";

/** The window's Agent/Write mode lives in doc-tabs (source mode reads it
 *  too); the first editor opens on the start page chosen in Settings
 *  (默认首页: Agent unless set to Write). */
function initialSurface(agentFirst: boolean) {
  const current = getWindowSurface();
  if (current !== null) return current;
  setWindowSurface(agentFirst);
  return agentFirst;
}

interface MilkdownEditorProps {
  /** The owning tab - the key App.tsx flushes this editor under (see
   *  editor-flush.ts). */
  tabId: string;
  documentId?: string;
  filePath: string | null;
  initialValue: string;
  onChange: (markdown: string) => void;
  /** The tab's display name (doc-tabs' `tabTitle`) - what the detached chat
   *  window puts in its title bar. Passed down rather than derived from
   *  `filePath`, which is null for the bundled Help documents. */
  docTitle: string;
  /** Whether this is the tab the user is looking at. Every open tab stays
   *  mounted (App.tsx hides the rest with display:none), so the detached
   *  chat - which follows the ACTIVE document - needs to know which of them
   *  should be feeding it. */
  isActive?: boolean;
  /** True while the onboarding tour runs: real AI is muted end to end -
   *  typing-triggered plugins go quiet (editor-extensions), on-demand
   *  triggers are ignored, and the chat answers from a pre-written script
   *  instead of the backend. First-run users have no AI account yet. */
  tutorialMock?: boolean;
}

export function MilkdownEditor({
  tabId,
  documentId = tabId,
  filePath,
  docTitle,
  initialValue,
  onChange,
  isActive = true,
  tutorialMock = false,
}: MilkdownEditorProps) {
  const [menu, setMenu] = useState<EditorMenuState>(null);
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const { imageNameRequest, requestImageName, closeImageNameDialog } =
    useImageNameRequest();
  // The Quick Ask zone widget's DOM container (quick-ask-widget-plugin) -
  // null whenever no widget is in the document. InlineChat portals into it,
  // so the panel's actual pixels sit wherever ProseMirror placed the
  // decoration (in the document flow, pushing content below it down).
  const [quickAskEl, setQuickAskEl] = useState<HTMLElement | null>(null);
  // iPhone: Quick Ask docks at the bottom of the screen instead.
  const phone = usePhoneLayout();
  const { t, settings, setSettings } = useSettings();

  // The editor plugin chain (useTextusEditor) is only built once, so
  // plugins read these refs to see live settings instead of the value
  // captured at construction time.
  const settingsRef = useLatest(settings);
  const filePathRef = useLatest(filePath);
  const docTitleRef = useLatest(docTitle);
  const isActiveRef = useLatest(isActive);
  const tutorialMockRef = useLatest(tutorialMock);
  const tRef = useLatest(t);
  // Untitled documents are named from their text (useAutoTitle.ts).
  const noteTitleContent = useAutoTitle(
    tabId,
    filePath,
    settings,
    initialValue,
  );
  // Every change while the Agent shows this document re-renders its panel:
  // a picture inserted when its job finishes - after the reply - used to
  // leave the panel showing the text without it.
  const [docVersion, bumpDocVersion] = useReducer((n: number) => n + 1, 0);
  const agentShownRef = useRef(false);
  const reporting = useDocumentReporting(initialValue, (markdown) => {
    onChange(markdown);
    noteTitleContent(markdown);
    if (agentShownRef.current) bumpDocVersion();
  });
  // Defined further down (useGrammarPopover); read through a ref here.
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
    tutorialMockRef,
    tRef,
    setQuickAskEl,
    requestImageName,
  });

  const run = useEditorRunner();
  const { copyOrCut, paste, selectAll, insertText } = useEditorClipboard(run);
  useEditorFlush(tabId, run, reporting);

  const { aiNotice, showAiNotice, holdAiNotice, releaseAiNotice } =
    useAiNotice();

  const { triggerCompletion, triggerGrammarCheck } = useAiActions(
    run,
    () => settingsRef.current,
    () => tRef.current,
    showAiNotice,
    () => filePathRef.current,
  );
  const inlineChat = useInlineChat(run);
  useQuickAskDecorations(run, inlineChat, phone);
  // The empty-document placeholder reads the language when it draws, and
  // decorations only draw on a transaction: without one, switching the
  // language in Settings (or on the first-run picker) left the old text.
  // The diary also needs this refresh to release a pending turn on disable.
  useEffect(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta("addToHistory", false));
    });
  }, [settings.language, settings.enableMagicDiary, run]);

  const [startOpen] = useState(
    () =>
      !phone &&
      !tutorialMock &&
      initialSurface(settings.defaultHome !== "write"),
  );
  const workspace = useDocumentWorkspace(run, documentId, startOpen);
  const [workspaceMounted, setWorkspaceMounted] = useState(startOpen);
  // The active tab sets the window's surface; a tab becoming active
  // follows it.
  const setWorkspaceOpen = workspace.setOpen;
  // Recorded only when the user switches surface on the active tab - not
  // when a tab becomes active, which would write that tab's own old mode
  // over the window's before the next effect applies it.
  const wasActive = useRef(isActive);
  useEffect(() => {
    const becameActive = isActive && !wasActive.current;
    wasActive.current = isActive;
    if (!phone && !tutorialMock && isActive && !becameActive)
      setWindowSurface(workspace.open);
  }, [workspace.open, isActive, phone, tutorialMock]);
  useEffect(() => {
    const surface = getWindowSurface();
    if (phone || tutorialMock || !isActive || surface === null) return;
    if (surface) setWorkspaceMounted(true);
    setWorkspaceOpen(surface);
    // Only on becoming active: the other effect records changes made here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);
  // Leaving Agent for Write hands the caret to the page: the Agent
  // composer had it, and Write is where the next keys belong (an empty
  // Magic Diary waits there with its caret). Not out of an open dialog.
  const wasOpen = useRef(workspace.open);
  useEffect(() => {
    const left = wasOpen.current && !workspace.open;
    wasOpen.current = workspace.open;
    if (left && isActive && !modalDialogOpen())
      run((ctx) => ctx.get(editorViewCtx).focus());
    // The page rises into place as Agent steps back (workspace.css).
    const root = rootRef.current;
    if (left && isActive && root) {
      root.classList.remove("surface-arrive");
      void root.offsetWidth;
      root.classList.add("surface-arrive");
      const done = (event: AnimationEvent) => {
        if (event.target !== root) return;
        root.classList.remove("surface-arrive");
        root.removeEventListener("animationend", done);
      };
      root.addEventListener("animationend", done);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.open, isActive, run]);
  /** Agent (true) or Write: the surface switch, and its shortcut. */
  const switchSurface = (agent: boolean) => {
    if (agent === workspace.open) return;
    if (agent) {
      setWorkspaceMounted(true);
      agentPanel.setOpen(false);
    }
    workspace.setOpen(agent);
  };
  const switchRef = useLatest(switchSurface);
  useEffect(() => {
    if (!isActive || phone || tutorialMock) return;
    const flip = () => switchRef.current(!wasOpen.current);
    window.addEventListener(TOGGLE_SURFACE_EVENT, flip);
    return () => window.removeEventListener(TOGGLE_SURFACE_EVENT, flip);
  }, [isActive, phone, tutorialMock, switchRef]);
  const [allowAutoImages, setAllowAutoImages] = useState(false);
  const reader = useWritePlayback(
    run,
    isActive && !workspace.open && !tutorialMock,
  );
  useEditorDictationTarget(run, isActive && !workspace.open);
  const proposals = useEditorProposals({
    run,
    pendingEditActionsRef,
    settingsRef,
    settings,
    filePath,
    tutorialMock,
    t,
    workspace,
  });
  const { pendingEdits, conversation, quickConversation, showProposals } =
    proposals;
  const images = useDocumentImages(
    run,
    documentId,
    filePath,
    workspace,
    conversation.conversationId,
    settings.language,
  );
  // Save As copied this document's images next to it: point the image
  // nodes at their new paths without remounting (useSaveTabs).
  useEffect(() => {
    const rewrite = (event: Event) => {
      const detail = (event as CustomEvent<RewriteImageSrcs>).detail;
      if (detail.tabId !== tabId) return;
      const moved = new Map<string, string>();
      for (const { old, new: next } of detail.mappings) {
        moved.set(old, next);
        moved.set(decodeLocalPath(old), next);
      }
      // The rewritten srcs are relative to the new location, and the image
      // views resolve them as they redraw - right now, before the tab's
      // new path has come back down as a prop. Read against the old (no)
      // path they drew a broken picture until the document was reopened.
      (filePathRef as { current: string | null }).current = detail.docPath;
      const done = run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const tr = view.state.tr;
        view.state.doc.descendants((node, pos) => {
          if (node.type.name !== "image") return;
          const next = moved.get(node.attrs.src as string);
          if (next)
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: next });
        });
        if (tr.docChanged) view.dispatch(tr.setMeta("addToHistory", false));
        return true;
      });
      if (done) detail.handled = true;
    };
    window.addEventListener(REWRITE_IMAGE_SRCS_EVENT, rewrite);
    return () => window.removeEventListener(REWRITE_IMAGE_SRCS_EVENT, rewrite);
  }, [tabId, run, filePathRef]);
  // Links this conversation's saved copy to its document once an exchange
  // or an accepted draft has settled: by identity, and for an untitled
  // document by its text, so the history list can bring both back.
  const historyLength = conversation.history.length;
  const conversationId = conversation.conversationId;
  const settled = !conversation.busy;
  useEffect(() => {
    if (!settled || historyLength === 0 || tutorialMock) return;
    const timer = setTimeout(() => {
      const text = filePath
        ? null
        : run((ctx) =>
            ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
          );
      rememberConversationDocument(
        conversationId,
        documentId,
        text?.trim() ? text : null,
      );
    }, 800);
    return () => clearTimeout(timer);
  }, [
    settled,
    historyLength,
    conversationId,
    documentId,
    filePath,
    run,
    tutorialMock,
    workspace.draft,
  ]);
  // A task opened from the history list for this document (App routed it
  // here): restore its conversation, on the Agent surface.
  const restoreConversation = conversation.restore;
  useEffect(() => {
    const check = () => {
      const key = [`path:${filePath}`, `doc:${documentId}`].find((k) =>
        pendingTaskRestores.has(k),
      );
      if (!key) return;
      const entry = findConversation(pendingTaskRestores.get(key)!);
      pendingTaskRestores.delete(key);
      if (!entry) return;
      restoreConversation(entry.id, entry.turns);
      setWindowSurface(true);
      setWorkspaceMounted(true);
      setWorkspaceOpen(true);
    };
    check();
    window.addEventListener(RESTORE_TASK_EVENT, check);
    return () => window.removeEventListener(RESTORE_TASK_EVENT, check);
  }, [filePath, documentId, restoreConversation, setWorkspaceOpen]);
  // Tells File > Open not to replace this tab while it holds Agent work.
  const engaged =
    conversation.history.length > 0 ||
    conversation.busy ||
    !!workspace.draft?.operations.length ||
    images.pending;
  useEffect(() => {
    setTabEngaged(tabId, engaged);
  }, [tabId, engaged]);
  useEffect(() => () => setTabEngaged(tabId, false), [tabId]);
  const refreshImages = images.refresh;
  const settleImages = images.settle;
  useEffect(() => {
    if (!conversation.busy) void settleImages();
  }, [conversation.busy, settleImages]);
  // Only image tool turns can enqueue jobs; other streamed turns need no IPC.
  const imageTurns = [
    ...conversation.history,
    ...(conversation.streaming?.turns ?? []),
  ].filter(
    (turn) =>
      (turn.kind === "ToolCall" && turn.name === "generate_image") ||
      turn.kind === "ToolResult",
  ).length;
  useEffect(() => {
    void refreshImages();
  }, [imageTurns, refreshImages]);
  const stopTask = () => {
    conversation.stop();
    void images.stopRunning().catch(() => {});
  };
  const selectionIllustration = useSelectionIllustration(
    run,
    settings,
    images,
    documentId,
  );
  const recovery = useWorkspacePersistence({
    workspace,
    conversation,
    run,
    documentId,
    tabId,
    path: filePath,
    enabled: settings.enableDraftRecovery && !tutorialMock,
    language: settings.language,
    imagePending: images.pending,
    stopImages: images.stopRunning,
  });
  const finishWorkspace = workspace.finish;
  const failed = !!conversation.error;
  useEffect(() => {
    // A failed stream offers Retry; keeping its partial proposal would
    // duplicate the retried one.
    if (!conversation.busy) finishWorkspace(failed ? "failed" : "stopped");
  }, [conversation.busy, finishWorkspace, failed]);

  const {
    quickSendContext,
    panelSendContext,
    detachedChatLabel,
    pushChatStatuses,
    pushLiveContext,
    forcePushLiveContext,
    handleDetachChat,
  } = useChatContextBridge({
    run,
    inlineChat,
    proposals,
    filePath,
    docTitle,
    filePathRef,
    docTitleRef,
    isActiveRef,
    settings,
    t,
  });

  // The docked panel (ai/chat/panel/agent-panel.tsx): rendered by THIS editor only
  // while it is the active tab and the panel is open.
  const agentPanel = useAgentPanel();
  const panelContainer = isActive ? agentPanel.container : null;
  const { panelSelection, updatePanelSelection } = usePanelSelection(
    run,
    panelContainer,
  );

  // A new selection becomes a new chip in the detached window and the
  // panel - "re-drag to highlight and it goes in" is the behaviour that
  // separates those surfaces from the in-document Quick Ask bar.
  onSelectionChangeRef.current = () => {
    pushLiveContext();
    updatePanelSelection();
    grammarCaretRef.current();
  };

  // Becoming the active tab, or saving under a new path, re-points the chat
  // at this document.
  useEffect(() => {
    forcePushLiveContext();
  }, [forcePushLiveContext, isActive, filePath]);

  // Only the active tab reports statuses, for the same reason it is the only
  // one that pushes context: otherwise every hidden tab broadcasts its own
  // and whichever rendered last wins.
  useEffect(() => {
    if (detachedChatLabel && isActive)
      pushChatStatuses(pendingEdits.allStatuses);
  }, [detachedChatLabel, isActive, pushChatStatuses, pendingEdits.allStatuses]);

  const {
    handleFocusNext,
    handleFocusPrevious,
    handleAcceptFocused,
    handleRejectFocused,
  } = useQuickAskReview({ run, pendingEdits, inlineChat, phone, isActive });

  const {
    chatGuard,
    setChatGuard,
    quickAskHost,
    chatComposer,
    keepQuickAskTargetInView,
    performChatAction,
    requestChatAction,
    openAgentConversation,
    startNewAgentConversation,
    toggleAgentConversation,
    expandQuickAsk,
  } = useQuickAskControls({
    run,
    inlineChat,
    pendingEdits,
    conversation,
    quickConversation,
    quickAskEl,
    phone,
    isActive,
    settings,
    agentPanel,
    handleDetachChat,
  });

  useModeSwitchCaret(run, isActive, initialValue);
  useFocusModeRefresh(run, isActive, settings.typewriterMode);

  const grammar = useGrammarPopover(run, () => t.grammarApplyStale);
  // A phone has no hover and no arrow keys - a tap on an underline is the
  // way in, so there the caret opens the suggestion only right after a
  // touch, not whenever typing happens to end against a flagged word (the
  // ranges include their edges). The listener reports the selection while
  // the transaction is still being applied, before the view holds it, so
  // the phone's check waits a frame to see where the tap put the caret.
  const lastTouchRef = useRef(0);
  const onGrammarCaret = grammar.onCaretMove;
  grammarCaretRef.current = () => {
    if (!phone) onGrammarCaret();
    else if (Date.now() - lastTouchRef.current < 800)
      requestAnimationFrame(onGrammarCaret);
  };
  const findReplace = useFindReplace(run);

  // A phone shows the menu and the grammar card as action sheets, which
  // usePopupDismiss leaves alone.
  usePopupDismiss({
    anyPopup: !phone && (menu !== null || grammar.popover !== null),
    setMenu,
    hideGrammar: grammar.hide,
    settingsRef,
  });

  useEditorWindowEvents({
    run,
    settings,
    tutorialMock,
    triggerCompletion,
    triggerGrammarCheck,
    toggleAgentConversation,
    findReplace,
    insertText,
    copyOrCut,
    paste,
    selectAll,
    openTableDialog: () => setTableDialogOpen(true),
    setMenu,
    conversation,
    agentPanel,
  });

  // The Agent surface's document card: serialize only when it is visible and
  // the document can have changed, not on every streamed chunk.
  const hasDraftOperations = !!workspace.draft?.operations.length;
  const workspaceVisible = workspace.open && isActive;
  const documentMarkdown = useMemo(
    () =>
      workspaceVisible && !hasDraftOperations
        ? (run((ctx) =>
            ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
          ) ?? "")
        : "",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      workspaceVisible,
      hasDraftOperations,
      run,
      conversation.history,
      docVersion,
    ],
  );
  useEffect(() => {
    agentShownRef.current = workspaceVisible;
  }, [workspaceVisible]);
  // Pictures still on their way, shown in the panel under their anchors. A
  // finished one waiting for its text shows itself; one that is finished
  // but could not go in by itself is the job list's (ImageJobsPanel), not
  // a "making this picture" card that never ends.
  // Pictures accepted on their own while their text still waits
  // (acceptDraftImage): shown as 已采纳, inserted with that text.
  const [approvedImages, setApprovedImages] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const { waitsForDraft, isLive, skipped } = images;
  const pendingImages = useMemo(
    () =>
      images.jobs.flatMap((job) => {
        const ready = job.status === "ready";
        const waiting = ready && waitsForDraft(job);
        if (
          !["queued", "running", "preparing"].includes(job.status) &&
          !waiting &&
          !(ready && isLive(job.jobId))
        )
          return [];
        return [
          {
            id: job.jobId,
            anchor: job.request.anchor,
            prompt: job.request.prompt,
            ...(waiting && job.previewPath
              ? { preview: convertFileSrc(job.previewPath) }
              : {}),
            // Decided while painting, or once painted and waiting.
            ...(skipped.has(job.jobId) ? { skipped: true } : {}),
            ...(approvedImages.has(job.jobId) ? { approved: true } : {}),
          },
        ];
      }),
    // workspace.draft: whether a picture still waits for its text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      images.jobs,
      waitsForDraft,
      isLive,
      skipped,
      approvedImages,
      workspace.draft,
    ],
  );
  // The review card's container, once ProseMirror has drawn the expanded
  // card (a widget, so a frame or two after the state change).
  const editorFrame = selectionIllustration.editorFrame;
  const [refinerHost, setRefinerHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let frame = 0;
    let tries = 0;
    const find = () => {
      const host = editorFrame
        ? document.querySelector<HTMLElement>(
            `[data-placeholder-editor="${editorFrame}"]`,
          )
        : null;
      if (host || !editorFrame || tries++ > 30) setRefinerHost(host);
      else frame = requestAnimationFrame(find);
    };
    find();
    return () => cancelAnimationFrame(frame);
  }, [editorFrame]);
  const zh = settings.language.startsWith("zh");
  const homeEmpty =
    !conversation.history.length &&
    !conversation.busy &&
    !conversation.streaming;
  const suggestions = useAgentSuggestions(
    settings,
    documentMarkdown,
    workspaceVisible && homeEmpty && !tutorialMock,
  );
  // Draft text that went in, however it was accepted - auto-writing
  // moves on to the next section once one of its own is (AutoWriter).
  const acceptedCount = useRef(0);
  const acceptDraft = (callId?: string) => {
    const task = workspace.currentDraft()?.id;
    if (!workspace.accept(callId)) return;
    acceptedCount.current++;
    // Pictures the Agent made for this text can go in now that it exists.
    if (task) images.adoptTask(task);
  };
  /** The draft's unfinished pictures whose paragraph is in change `callId`
   *  (any change when omitted: all of the draft's pictures). */
  const draftImageJobs = (callId?: string) => {
    const draft = workspace.currentDraft();
    if (!draft) return [];
    const texts = draft.operations
      .filter((op) => !callId || op.callId === callId || op.parent === callId)
      .map((op) => op.proposal.text ?? "");
    return images.jobs.filter((job) => {
      if (
        job.taskId !== draft.id ||
        ["committed", "cancelled", "failed"].includes(job.status)
      )
        return false;
      if (!callId) return true;
      const line = job.request.anchor
        .split("\n")
        .find((l) => l.trim())
        ?.trim();
      return !!line && texts.some((text) => text.includes(line));
    });
  };
  // Rejected text takes its pictures with it: they would wait forever for
  // a paragraph that is never coming.
  // Rejected text sets its pictures aside with it, not away: taking the
  // text after all (restoreChange) brings them back.
  const rejectDraft = (callId?: string) => {
    for (const job of draftImageJobs(callId)) images.skip(job.jobId);
    workspace.discard(callId);
  };
  /** One paragraph of a change, decided in the preview: the change is
   *  split into paragraphs first (once), then just that one is taken or
   *  set aside - with the pictures made for it. */
  const decidePart = (callId: string, part: number, take: boolean) => {
    let id = callId;
    if (part >= 0) {
      const parts = workspace.explode(callId);
      // Still arriving: nothing to split yet, so nothing is decided.
      if (!parts.length) return;
      id = parts[part] ?? callId;
    }
    if (take) acceptDraft(id);
    else rejectDraft(id);
  };
  /** A rejected paragraph or change back to undecided (恢复), its
   *  pictures with it. */
  const undoReject = (callId: string) => {
    const op = workspace.rejected.find((o) => o.callId === callId);
    if (!op) return;
    const text = op.proposal.text ?? "";
    if (!workspace.undoReject(callId, op.proposal, conversation.conversationId))
      return;
    for (const job of images.jobs) {
      const line = job.request.anchor
        .split("\n")
        .find((l) => l.trim())
        ?.trim();
      if (line && text.includes(line)) images.unskip(job.jobId);
    }
  };
  /** A rejected change taken after all - from its chat card or the change
   *  list - with the pictures made for its text. */
  const restoreChange = (callId: string, proposal: EditProposal) => {
    const text = proposal.text ?? "";
    const held = images.jobs.filter((job) => {
      if (["committed", "cancelled", "failed"].includes(job.status))
        return false;
      const line = job.request.anchor
        .split("\n")
        .find((l) => l.trim())
        ?.trim();
      return !!line && text.includes(line);
    });
    if (!workspace.reinstate(callId, proposal, conversation.conversationId))
      return;
    acceptedCount.current++;
    for (const job of held) {
      images.unskip(job.jobId);
      images.adoptTask(job.taskId);
    }
  };
  // A finished picture accepted on its own: only the picture, never text
  // with it. Its paragraph already in the document, it goes in now; still
  // in the draft, it is marked and goes in when that text is accepted.
  const acceptDraftImage = (jobId: string) => {
    images.unskip(jobId);
    const job = images.jobs.find((j) => j.jobId === jobId);
    if (!job) return;
    if (job.status === "ready" && images.anchorLive(job)) {
      void images.accept(job);
      return;
    }
    setApprovedImages((prev) => new Set(prev).add(jobId));
  };
  const skipDraftImage = (jobId: string) => {
    setApprovedImages((prev) => {
      const next = new Set(prev);
      next.delete(jobId);
      return next;
    });
    images.skip(jobId);
  };

  // Auto-writing (AutoWriter.tsx): each section is one ordinary create
  // request through this workspace, so it lands as a reviewed draft - with
  // images authorized for that request when the section asks for one. It
  // starts from a send in Create mode once project material is picked in
  // the composer's folder chip (ProjectChip).
  const [autoRequest, setAutoRequest] = useState<AutoWriteRequest | null>(null);
  // "分节写作" in "+": this request is planned as sections and written one
  // by one, folder or not (project material only adds to what it reads).
  const [sectioned, setSectioned] = useState(false);
  // The project folder is optional: the composer shows it only once added
  // from "+", and its × takes it away again.
  const [folderAdded, setFolderAdded] = useState(false);
  const project = useProjectMaterial(
    filePath,
    settings.agentWorkspaceRoot || null,
    workspace.open && isActive,
  );
  const autoHost: AutoWriterHost = {
    docPath: filePath,
    busy: conversation.busy,
    send: async (message, allowImages) => {
      if (
        !recovery.loaded ||
        !workspace.begin("create", conversation.conversationId)
      )
        return false;
      const draft = workspace.currentDraft();
      const imageTask =
        allowImages && draft && !draft.conflicted && draft.baseRevision >= 0
          ? images.authorizeTask(draft.id, draft.baseRevision)
          : null;
      const context = await panelSendContext();
      const turns = await conversation.send(
        context?.document ?? "",
        message,
        [],
        {
          mode: "create",
          webSearch: false,
          imageTask,
          focusHeading: context?.focusHeading ?? null,
        },
      );
      if (!turns) return false;
      const proposals = proposalsFromTurns(turns);
      if (proposals.length) showProposals(proposals);
      return true;
    },
    pending: () => workspace.currentDraft()?.operations.length ?? 0,
    pendingCount: workspace.draft?.operations.length ?? 0,
    acceptedCount: () => acceptedCount.current,
    acceptAll: () => acceptDraft(),
    rejectAll: () => rejectDraft(),
    stop: stopTask,
  };
  // The Agent's own entries in the composer's "+" menu.
  const agentMenu: ComposerMenuItem[] = [
    {
      key: "project",
      section: "add",
      icon: <FolderIcon />,
      label: folderAdded
        ? zh
          ? "更换项目文件夹"
          : "Change project folder"
        : zh
          ? "添加项目文件夹"
          : "Add project folder",
      hint: folderAdded
        ? project.folder
          ? basename(project.folder)
          : ""
        : zh
          ? "可选：参考里面的大纲、资料和图片写作"
          : "Optional: write from its outline, material and pictures",
      select: () => {
        // The document's own folder (or the one chosen before) is offered
        // first; a document with neither asks for one.
        if (!folderAdded && project.folder) {
          setFolderAdded(true);
          return;
        }
        void ai
          .pickWorkspaceRoot()
          .then((picked) => {
            if (!picked) return;
            setSettings({ agentWorkspaceRoot: picked });
            setFolderAdded(true);
          })
          .catch(() => {});
      },
    },
    {
      key: "sections",
      section: "tools",
      icon: <OutlineTabIcon />,
      label: zh ? "分节写作" : "Write in sections",
      chip: zh ? "分节写作" : "Sections",
      hint: zh
        ? "先列出章节，再逐节写成草稿，适合长文"
        : "Plans the sections, then drafts them one by one - for long pieces",
      on: sectioned,
      disabled: conversation.busy || !!autoRequest,
      select: () => setSectioned((on) => !on),
    },
    {
      key: "images",
      section: "tools",
      icon: <ImageFileIcon />,
      label: zh ? "允许本次请求配图" : "Allow images for this request",
      chip: zh ? "配图" : "Images",
      hint: zh
        ? "调用图片服务，可能产生费用"
        : "Uses the image service; may incur charges",
      on: allowAutoImages,
      disabled: conversation.busy,
      select: () => setAllowAutoImages((on) => !on),
    },
  ];
  const labels = useMemo(
    () => chatLabels(t, settings.language),
    [t, settings.language],
  );

  const decidableCount = pendingEdits.decidable.length;
  const [panelGuard, setPanelGuard] = useState(false);
  useEffect(() => {
    if (decidableCount === 0) setPanelGuard(false);
  }, [decidableCount]);
  function startPanelConversation() {
    if (pendingEdits.decidable.length > 0) {
      setPanelGuard(true);
      return;
    }
    setPanelGuard(false);
    conversation.reset();
  }

  const { rootRef, paneEl, scrollEl, contentEl } = useEditorPane();
  // Blanks to fill (【开幕日期】, fill-slot-plugin.ts): a click on one in
  // this editor opens the card that fills it.
  const [fillRequest, setFillRequest] = useState<FillSlotRequest | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      if (!contentEl?.contains(event.target as Node)) return;
      setFillRequest((event as CustomEvent<FillSlotRequest>).detail);
    };
    window.addEventListener(FILL_SLOT_EVENT, open);
    return () => window.removeEventListener(FILL_SLOT_EVENT, open);
  }, [contentEl]);
  // The window bar's slots (WindowBar.tsx): present once App has mounted.
  const [barSlots, setBarSlots] = useState<{
    start: HTMLElement | null;
    end: HTMLElement | null;
  } | null>(null);
  // Found again whenever the bar is drawn anew: holding on to slots that
  // left the page put "写作 →" and "← Agent" somewhere no one could see.
  useEffect(() => {
    const find = () => {
      const start = document.querySelector<HTMLElement>(".window-bar-start");
      const end = document.querySelector<HTMLElement>(".window-bar-end");
      setBarSlots((prev) =>
        prev?.start === start && prev?.end === end ? prev : { start, end },
      );
    };
    // A new bar is a child change of the shell; new slots inside the same
    // bar (its children redrawn or reordered) are child changes of the bar
    // and of its status group. What is portalled INTO a slot changes the
    // slot's own children, which nothing here watches.
    const shell = document.querySelector(".app-shell") ?? document.body;
    const watch = new MutationObserver(() => {
      find();
      observe();
    });
    const observe = () => {
      watch.disconnect();
      watch.observe(shell, { childList: true });
      for (const el of document.querySelectorAll(
        ".window-bar, .window-bar-status",
      ))
        watch.observe(el, { childList: true });
    };
    find();
    observe();
    return () => watch.disconnect();
  }, []);
  // The Agent surface starts below the tab bar when there is one, so tabs
  // stay reachable from Agent.
  useEffect(() => {
    if (!paneEl) return;
    let bar: HTMLElement | null = null;
    const sizes = new ResizeObserver(() => place());
    const place = () => {
      const next = paneEl.querySelector<HTMLElement>(":scope > .tab-bar");
      if (next !== bar) {
        if (bar) sizes.unobserve(bar);
        if (next) sizes.observe(next);
        bar = next;
      }
      paneEl.style.setProperty(
        "--agent-top",
        `${bar ? bar.offsetHeight : 28}px`,
      );
    };
    place();
    // Tabs opening or closing add or remove the bar itself.
    const children = new MutationObserver(place);
    children.observe(paneEl, { childList: true });
    return () => {
      sizes.disconnect();
      children.disconnect();
    };
  }, [paneEl]);
  const { reviewBarShown, stepReview, revealProposal } = useReviewBar({
    run,
    pendingEdits,
    isActive,
    phone,
    quickAskVisible: inlineChat.visible,
    panelContainer,
    agentPanel,
  });

  const notes = useReviewNotes({
    run,
    reviewNotesRef,
    noMarginRef,
    conversation,
    quickConversation,
    pendingEdits,
    revisionDisplay: settings.revisionDisplay,
    agentPanel,
    t,
    showAiNotice,
  });

  function popOutPanel() {
    handleDetachChat();
    agentPanel.setOpen(false);
  }

  function onContextMenu(e: MouseEvent) {
    // Portals (Quick Ask, the find bar) bubble React events through here:
    // their text fields keep the native Cut/Copy/Paste menu instead of the
    // editor's, whose Paste would have gone into the document.
    // Nor the Agent surface, portalled under this root too: its parts have
    // their own menus (a past task's), and the editor's - Paste, lists,
    // tables - would act on a document it isn't showing.
    if (
      (e.target as HTMLElement).closest?.(
        ".inline-chat, .find-replace-bar, .agent-workspace-layer, input, textarea",
      )
    )
      return;
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      imagePos: contextMenuTarget(run, e),
    });
  }

  return (
    <div
      ref={rootRef}
      onContextMenu={onContextMenu}
      // iOS fires mouseover on a tap; there the caret opens the suggestion.
      onMouseOver={
        phone
          ? undefined
          : (e) => {
              grammar.onMouseOver(e);
              notes.hoverNotes(e.target as HTMLElement);
            }
      }
      onMouseOut={phone ? undefined : grammar.onMouseOut}
      onPointerDown={() => (lastTouchRef.current = Date.now())}
      onPointerUp={() => (lastTouchRef.current = Date.now())}
    >
      {/* Agent | 写作: one switch at the window bar's start, in both. */}
      {!phone &&
        barSlots?.start &&
        isActive &&
        createPortal(
          <SurfaceSwitch
            agent={workspace.open}
            zh={zh}
            docTitle={docTitle}
            shortcut={formatCombo(settings.shortcuts.toggleSurface)}
            onChange={switchSurface}
          />,
          barSlots.start,
        )}
      {barSlots?.end &&
        isActive &&
        !workspace.open &&
        !tutorialMock &&
        createPortal(
          <WritePlayback reader={reader} language={settings.language} />,
          barSlots.end,
        )}
      {/* Progress and approval live in the picture's frame in the document;
          this chip only reports how an illustration ended. */}
      {paneEl &&
        createPortal(
          <Presence
            show={
              !!(selectionIllustration.error || selectionIllustration.notice) &&
              isActive
            }
            exitMs={180}
          >
            {(selectionIllustration.error || selectionIllustration.notice) && (
              <PresenceDiv
                role={selectionIllustration.error ? "alert" : "status"}
                className={`selection-illustration-status${selectionIllustration.error ? " is-error" : " is-done"}`}
              >
                <span>
                  {selectionIllustration.error || selectionIllustration.notice}
                </span>
                <button
                  aria-label={zh ? "关闭" : "Dismiss"}
                  onClick={selectionIllustration.dismiss}
                >
                  ×
                </button>
              </PresenceDiv>
            )}
          </Presence>,
          paneEl,
        )}
      {/* Adjusting a drafted prompt happens inside its card in the
          document: the card leaves a container for this conversation. */}
      {refinerHost &&
        selectionIllustration.review &&
        createPortal(
          <PromptRefiner
            inline
            approve
            prompt={selectionIllustration.review.prompt}
            anchor={selectionIllustration.review.anchor}
            onClose={selectionIllustration.closeEditor}
            onCancel={selectionIllustration.stop}
            onRegenerate={(prompt) =>
              void selectionIllustration.approve(prompt)
            }
          />,
          refinerHost,
        )}
      <Milkdown />
      {!workspace.open && (
        <ImageJobsPanel language={settings.language} images={images} />
      )}
      {workspaceMounted &&
        paneEl &&
        createPortal(
          <div
            className="agent-workspace-layer"
            hidden={!isActive}
            data-open={workspace.open}
            inert={!workspace.open}
          >
            <AgentWorkspace
              language={settings.language}
              documentPath={filePath}
              draft={workspace.draft}
              preview={
                hasDraftOperations ? workspace.preview : documentMarkdown
              }
              conflict={workspace.conflict}
              conversation={conversation}
              onAccept={acceptDraft}
              onImageAccept={acceptDraftImage}
              onImageReject={skipDraftImage}
              suggestions={suggestions.items}
              aiSuggestions={suggestions.ai}
              onReject={rejectDraft}
              rejected={workspace.rejected}
              onRestore={restoreChange}
              onDecidePart={decidePart}
              onUndoReject={undoReject}
              isSettled={workspace.isSettled}
              onStop={stopTask}
              toolLabels={labels.toolActivity}
              documentId={documentId}
              autoWriter={
                autoRequest ? (
                  <AutoWriter
                    key={autoRequest.id}
                    host={autoHost}
                    request={autoRequest}
                    onClose={() => setAutoRequest(null)}
                  />
                ) : null
              }
              pendingMedia={images.pending}
              mediaPreview={
                <ImageJobsPanel
                  language={settings.language}
                  images={images}
                  actionableOnly
                />
              }
              pendingImages={pendingImages}
            >
              {recovery.error && (
                <p role="alert">
                  {settings.language.startsWith("zh")
                    ? "草稿恢复或保存失败："
                    : "Draft recovery or save failed: "}
                  {recovery.error}
                </p>
              )}
              {recovery.interrupted && (
                <p role="status">
                  {settings.language.startsWith("zh")
                    ? "上次任务已中断；草稿已恢复，不会自动重发请求。"
                    : "The previous task was interrupted. Its draft was restored without restarting requests."}
                </p>
              )}
              <ChatBody
                document=""
                selectedText={panelSelection?.text ?? null}
                selectionMarkdown={null}
                docPath={filePath}
                workspaceRoot={settings.agentWorkspaceRoot || null}
                conversation={{ ...conversation, stop: stopTask }}
                defaultMode="create"
                allowCreate
                active={workspace.open && isActive}
                voiceLanguage={settings.language}
                beforeSend={(options) => {
                  if (
                    !recovery.loaded ||
                    !workspace.begin(options.mode, conversation.conversationId)
                  )
                    return false;
                  const draft = workspace.currentDraft();
                  const allowed = allowAutoImages;
                  setAllowAutoImages(false);
                  return {
                    ...options,
                    imageTask:
                      draft &&
                      allowed &&
                      !draft.conflicted &&
                      draft.baseRevision >= 0
                        ? images.authorizeTask(draft.id, draft.baseRevision)
                        : null,
                  };
                }}
                defaultWebSearch={settings.enableWebSearch}
                tutorialMock={tutorialMock}
                labels={labels}
                proposalStatus={(id) =>
                  workspace.statusOf(id) ?? pendingEdits.status(id)
                }
                pendingCount={workspace.draft?.operations.length ?? 0}
                fillHeight
                refreshContext={panelSendContext}
                onProposals={showProposals}
                onAcceptProposal={(id) => {
                  acceptDraft(id);
                }}
                onRejectProposal={(id) => {
                  rejectDraft(id);
                }}
                onRestoreProposal={restoreChange}
                onAcceptAll={() => {
                  acceptDraft();
                }}
                onRejectAll={() => {
                  rejectDraft();
                }}
                pendingBar={false}
                composerMenu={agentMenu}
                composerExtra={
                  folderAdded && (
                    <ProjectChip
                      project={project}
                      zh={zh}
                      disabled={conversation.busy || !!autoRequest}
                      onChangeFolder={() =>
                        void ai
                          .pickWorkspaceRoot()
                          .then((picked) => {
                            if (picked)
                              setSettings({ agentWorkspaceRoot: picked });
                          })
                          .catch(() => {})
                      }
                      onRemove={() => {
                        project.clear();
                        setFolderAdded(false);
                      }}
                    />
                  )
                }
                interceptSend={(message, options) => {
                  const picked =
                    folderAdded &&
                    !!project.folder &&
                    project.material.length + project.pictures.length > 0;
                  if (
                    options.mode !== "create" ||
                    !(sectioned || picked) ||
                    autoRequest
                  )
                    return false;
                  setAutoRequest({
                    id: crypto.randomUUID(),
                    folder: picked ? project.folder : null,
                    material: picked ? project.material : [],
                    pictures: picked ? project.pictures : [],
                    extra: message,
                    images: allowAutoImages,
                  });
                  setAllowAutoImages(false);
                  setSectioned(false);
                  return true;
                }}
              />
            </AgentWorkspace>
          </div>,
          paneEl,
        )}
      {isActive && scrollEl && contentEl && (
        <ReviewMargin
          view={notes.editorView}
          items={notes.marginItems}
          hot={notes.hotNote}
          scrollEl={scrollEl}
          contentEl={contentEl}
          labels={t}
          onHot={notes.setNoteHot}
          onDone={notes.doneNote}
          onAsk={notes.askAboutNote}
          onDecide={pendingEdits.decide}
          onCompact={notes.setNotesCompact}
          layoutKey={pendingEdits.previews}
        />
      )}
      <OpenReviewNote
        note={notes.openNoteData}
        at={notes.openNote}
        phone={phone}
        editorView={notes.editorView}
        t={t}
        onDone={notes.doneNote}
        onAsk={notes.askAboutNote}
        onClose={() => notes.setOpenNote(null)}
      />
      {paneEl &&
        createPortal(
          <Presence show={reviewBarShown} exitMs={200}>
            {reviewBarShown && (
              <ReviewBar
                labels={t}
                taken={pendingEdits.reviewCount.taken}
                total={pendingEdits.reviewCount.total}
                position={pendingEdits.stopIndex}
                stops={pendingEdits.reviewStops.length}
                phone={phone}
                onPrevious={() => stepReview(-1)}
                onNext={() => stepReview(1)}
                onAccept={pendingEdits.acceptAll}
                onReject={pendingEdits.rejectAll}
                onOpenChat={() => agentPanel.setOpen(true)}
                display={settings.revisionDisplay}
                displayName={(mode) => revisionDisplayName(t, mode)}
                onDisplay={(mode) => setSettings({ revisionDisplay: mode })}
              />
            )}
          </Presence>,
          paneEl,
        )}
      <Presence show={findReplace.open} exitMs={120}>
        {findReplace.open && (
          <FindReplaceBar findReplace={findReplace} labels={t} />
        )}
      </Presence>
      <EditorContextMenu
        menu={menu}
        run={run}
        t={t}
        settings={settings}
        tutorialMock={tutorialMock}
        generateSelectionImage={
          !workspace.open && !tutorialMock
            ? () => {
                void selectionIllustration.create();
              }
            : undefined
        }
        readSelection={
          !workspace.open && !tutorialMock
            ? () => {
                void reader.start("selection");
              }
            : undefined
        }
        openAgentConversation={openAgentConversation}
        triggerCompletion={triggerCompletion}
        triggerGrammarCheck={triggerGrammarCheck}
        copyOrCut={copyOrCut}
        paste={paste}
        selectAll={selectAll}
        toggleFindReplace={findReplace.toggle}
        openTableDialog={() => setTableDialogOpen(true)}
        onClose={() => setMenu(null)}
        docPath={filePath}
      />
      <Presence show={!!aiNotice} exitMs={120}>
        {aiNotice && (
          <PresenceDiv
            className="ai-notice floating-surface"
            role="status"
            onMouseEnter={holdAiNotice}
            onMouseLeave={releaseAiNotice}
          >
            {aiNotice}
          </PresenceDiv>
        )}
      </Presence>
      <Presence show={tableDialogOpen} exitMs={120}>
        {tableDialogOpen && (
          <InsertTableDialog
            title={t.insertTable}
            rowsLabel={t.insertTableRowsLabel}
            columnsLabel={t.insertTableColumnsLabel}
            confirmLabel={t.insertTableConfirm}
            cancelLabel={t.closePromptCancel}
            onInsert={(rows, cols) => insertTable(run, rows, cols)}
            onClose={() => setTableDialogOpen(false)}
          />
        )}
      </Presence>
      <Presence show={!!imageNameRequest} exitMs={120}>
        {imageNameRequest && (
          <ImageNameDialog
            request={imageNameRequest}
            title={t.imageNameDialogTitle}
            label={t.imageNameDialogLabel}
            invalidLabel={t.imageNameDialogInvalid}
            uploadLabel={t.imageNameDialogUpload}
            cancelLabel={t.closePromptCancel}
            onClose={closeImageNameDialog}
          />
        )}
      </Presence>
      <GrammarSuggestion
        grammar={grammar}
        phone={phone}
        t={t}
        onStale={() => showAiNotice(t.grammarApplyStale)}
      />
      {panelContainer &&
        createPortal(
          <EditorAgentPanel
            run={run}
            t={t}
            settings={settings}
            filePath={filePath}
            tutorialMock={tutorialMock}
            agentPanel={agentPanel}
            conversation={conversation}
            pendingEdits={pendingEdits}
            selectedText={panelSelection?.text ?? null}
            panelSendContext={async () => {
              workspace.endRouting();
              return panelSendContext();
            }}
            showProposals={showProposals}
            onRevealProposal={revealProposal}
            onLocateText={notes.locateText}
            noteNumber={(id) =>
              notes.notesBadged
                ? (notes.notes.find((n) => n.id === id)?.num ?? null)
                : null
            }
            onRevealPending={handleFocusNext}
            onNewConversation={startPanelConversation}
            onPopOut={popOutPanel}
            guard={panelGuard}
            setGuard={setPanelGuard}
          />,
          panelContainer,
        )}
      {fillRequest && (
        <FillSlotCard
          request={fillRequest}
          run={run}
          settings={settings}
          onClose={() => setFillRequest(null)}
        />
      )}
      {inlineChat.chatInfo &&
        inlineChat.visible &&
        quickAskHost &&
        // The panel renders through a portal into the zone widget's DOM
        // container (quick-ask-widget-plugin) - a real block in the
        // document flow, so it pushes content below it down instead of
        // floating over it. On a phone, into the page, docked above the
        // keyboard.
        createPortal(
          <InlineChat
            document={inlineChat.chatInfo.document}
            sendContext={async () => {
              workspace.endRouting();
              return quickSendContext();
            }}
            selectedText={inlineChat.chatInfo.selectedText}
            selectionMarkdown={inlineChat.chatInfo.selectionMarkdown}
            docPath={filePath}
            workspaceRoot={settings.agentWorkspaceRoot || null}
            conversation={quickConversation}
            // Edit-first: Quick Ask is opened on a passage to change it,
            // and Ask mode (the general default) turned "shorten this"
            // into a chat answer. Ask stays one click away in the picker.
            defaultMode="edit"
            defaultWebSearch={settings.enableWebSearch}
            tutorialMock={tutorialMock}
            labels={labels}
            onProposals={showProposals}
            proposalStatus={pendingEdits.status}
            onAcceptProposal={pendingEdits.accept}
            onRejectProposal={pendingEdits.reject}
            onAcceptAll={pendingEdits.acceptAll}
            onRejectAll={pendingEdits.rejectAll}
            pendingCount={pendingEdits.decidable.length}
            focusIndex={pendingEdits.focusIndex}
            onFocusNext={handleFocusNext}
            onFocusPrevious={handleFocusPrevious}
            onAcceptFocused={handleAcceptFocused}
            onRejectFocused={handleRejectFocused}
            onDetach={expandQuickAsk}
            onNewConversation={startNewAgentConversation}
            onRequestClose={() => requestChatAction("close")}
            confirm={
              chatGuard
                ? {
                    onProceed: () => performChatAction(chatGuard),
                    onCancel: () => {
                      setChatGuard(null);
                      chatComposer()?.focus();
                    },
                  }
                : null
            }
            docked={phone}
            onDockResize={keepQuickAskTargetInView}
          />,
          quickAskHost,
        )}
    </div>
  );
}
