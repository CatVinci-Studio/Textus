import { type MouseEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { useDocumentWorkspace } from "./useDocumentWorkspace";
import { useWorkspacePersistence } from "./useWorkspacePersistence";
import { AgentWorkspace } from "../ai/workspace/AgentWorkspace";
import { workspaceLabels } from "../ai/workspace/labels";
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
  const reporting = useDocumentReporting(initialValue, onChange);
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

  const workspace = useDocumentWorkspace(run, documentId);
  const [workspaceMounted, setWorkspaceMounted] = useState(false);
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
  const recovery = useWorkspacePersistence({
    workspace,
    conversation,
    run,
    documentId,
    tabId,
    path: filePath,
    enabled: settings.enableDraftRecovery && !tutorialMock,
    language: settings.language,
  });
  const finishWorkspace = workspace.finish;
  useEffect(() => {
    if (!conversation.busy) finishWorkspace();
  }, [conversation.busy, finishWorkspace]);

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
    if (
      (e.target as HTMLElement).closest?.(
        ".inline-chat, .find-replace-bar, input, textarea",
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
      {!phone && (
        <div className="workspace-launch">
          <button
            onClick={() => {
              setWorkspaceMounted(true);
              workspace.setOpen(true);
              agentPanel.setOpen(false);
            }}
          >
            {workspaceLabels(settings.language).open}
          </button>
        </div>
      )}
      <Milkdown />
      {workspaceMounted &&
        paneEl &&
        createPortal(
          <div hidden={!workspace.open || !isActive}>
            <AgentWorkspace
              language={settings.language}
              title={docTitle}
              draft={workspace.draft}
              preview={
                workspace.draft?.operations.length
                  ? workspace.preview
                  : (run((ctx) =>
                      ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
                    ) ?? "")
              }
              conflict={workspace.conflict}
              conversation={conversation}
              onEditor={() => workspace.setOpen(false)}
              onAccept={workspace.accept}
              onReject={workspace.discard}
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
                conversation={conversation}
                defaultMode="create"
                allowCreate
                beforeSend={(options) =>
                  recovery.loaded &&
                  workspace.begin(options.mode, conversation.conversationId)
                }
                defaultWebSearch={settings.enableWebSearch}
                tutorialMock={tutorialMock}
                labels={chatLabels(t, settings.language)}
                proposalStatus={(id) =>
                  workspace.statuses[id] ??
                  (workspace.draft?.operations.some((o) => o.callId === id)
                    ? "pending"
                    : pendingEdits.status(id))
                }
                pendingCount={workspace.draft?.operations.length ?? 0}
                fillHeight
                refreshContext={panelSendContext}
                onProposals={showProposals}
                onAcceptProposal={(id) => {
                  if (!conversation.busy) workspace.accept(id);
                }}
                onRejectProposal={(id) => {
                  if (!conversation.busy) workspace.discard(id);
                }}
                onAcceptAll={() => {
                  if (!conversation.busy) workspace.accept();
                }}
                onRejectAll={() => {
                  if (!conversation.busy) workspace.discard();
                }}
                pendingBar={false}
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
        openAgentConversation={openAgentConversation}
        triggerCompletion={triggerCompletion}
        triggerGrammarCheck={triggerGrammarCheck}
        copyOrCut={copyOrCut}
        paste={paste}
        selectAll={selectAll}
        toggleFindReplace={findReplace.toggle}
        openTableDialog={() => setTableDialogOpen(true)}
        onClose={() => setMenu(null)}
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
            labels={chatLabels(t, settings.language)}
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
