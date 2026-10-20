import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettings } from "../../../settings/SettingsContext";
import { useAgentConversation } from "../useAgentConversation";
import type { PendingStatus } from "../../revision/usePendingEdits";
import type { EditProposal } from "../../types";
import { ChatBody } from "../ChatBody";
import { chatLabels } from "../chat-labels";
import { ChatHistoryMenu } from "../ChatHistoryMenu";
import type { ChatRestore } from "../chat-restore";
import { reopenConversation, type ReopenTarget } from "../reopen-conversation";
import {
  CHAT_ADOPT_HANDOFF,
  CHAT_TO_EDITOR,
  EDITOR_TO_CHAT,
  onWindowEvent,
  sendToWindow,
  type ChatContext,
  type OpenDocumentMessage,
} from "./chat-bridge";
import { windowIpc } from "../../../platform/ipc";
import { flushPendingWrites } from "../../../storage/pending-writes";
import { PinIcon, PlusIcon } from "../../../ui/icons";
import { AppDialogHost } from "../../../ui/app-dialog";
import { WindowCaptionButtons } from "../../../ui/WindowCaptionButtons";
import { listenToThisWindow, unlistenAll } from "../../../utils/tauri-events";
import { useLatest } from "../../../utils/hooks/useLatest";
// Every theme custom property (--editor-bg, --editor-text, --editor-border,
// ...) is declared on :root in ui/base.css. This window doesn't render App,
// so without this import every var() resolves to nothing and the whole
// window is unstyled; the dialogs' look comes along for its close prompt.
import "../../../ui/base.css";
import "../../../ui/app-dialog.css";
import "../AgentTurnView.css";
import "../inline-chat.css";
import { Tooltip } from "../../../ui/Tooltip";
import { TextusAiOffNote } from "../../TextusAiSwitch";
import "./chat-window.css";

/** How long a send waits for the editor to answer a context request before
 *  going out with the last pushed copy. Short: this is same-machine window
 *  IPC, and blocking a send on a window that has gone unresponsive would be
 *  worse than sending a slightly older document. */
const CONTEXT_REQUEST_TIMEOUT_MS = 400;

/**
 * The chat as its own OS window - and, deliberately, the CROSS-FILE surface.
 *
 * A real window rather than a webview-drawn panel, because the point of
 * detaching is to put it OUTSIDE the main window - which only the platform's
 * own window can do, along with native edge/corner resizing and multi-monitor
 * placement.
 *
 * The Agent's two surfaces divide by scope, not by size: the in-document
 * Quick Ask bar is about ONE file and keeps the snapshot it opened with,
 * while this window follows the user. Switch tabs or windows and its
 * document, title and selection follow; highlight a new passage and it
 * arrives here as a new selection chip. There is only ever one of these
 * windows per scope (see commands/chat_window.rs), which is what makes
 * "follows the user" coherent - two of them would fight over the same
 * editor.
 *
 * It renders the same ChatBody as the embedded popup and, like the popup,
 * owns no document state: proposals and accept/reject are forwarded to the
 * editor window (chat-bridge.ts), which stays the single place edits are
 * resolved and applied. Losing that would mean two implementations of the
 * anchor/apply logic drifting apart.
 */
export function ChatWindowApp() {
  const { t, settings, setSettings } = useSettings();
  const [context, setContext] = useState<ChatContext | null>(null);
  const [statuses, setStatuses] = useState<Record<string, PendingStatus>>({});
  const [lost, setLost] = useState(false);
  // The editor currently being talked to, read inside callbacks that outlive
  // a render. Not fixed for the window's life: every context push re-points
  // it, which is how one window serves several documents (chat-bridge.ts).
  const editorLabel = useRef<string | null>(null);

  const agentModel = settings.agentModels[settings.aiProvider] || undefined;
  const conversation = useAgentConversation(
    context?.docPath ?? null,
    settings.agentWorkspaceRoot || null,
    settings.aiProvider,
    settings.enableWebSearch,
    agentModel,
    undefined,
    statuses,
  );
  const restored = useRef(false);

  // Whether any handoff has been claimed. The ref is what the async mount
  // check reads after its await (state would be a stale closure there); the
  // state is what gates rendering.
  const claimedRef = useRef(false);
  const [claimed, setClaimed] = useState(false);

  /**
   * Claims the handoff parked under this window's label and takes on what it
   * carries. Destructive, same contract as takeDetachedTab.
   *
   * Read through a ref because `conversation` is a fresh object every render
   * and both callers subscribe once, at mount.
   */
  const claimHandoff = useLatest(async () => {
    const handoff = await windowIpc.takeChatHandoff();
    if (!handoff) return false;
    claimedRef.current = true;
    setClaimed(true);
    editorLabel.current = handoff.editorLabel;
    setContext(handoff.state.context);
    setStatuses(handoff.state.statuses);
    if (handoff.state.turns.length > 0)
      conversation.restore(handoff.state.conversationId, handoff.state.turns);
    return true;
  });

  // Claim the handoff this window was created for. Once-only - the
  // module-level guard exists because StrictMode double-runs mount effects in
  // dev.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void (async () => {
      // Nothing to carry on from - the editor went away between creating this
      // window and it mounting. `claimedRef` keeps a detach that lands while
      // this claim is still in flight from being read as that: the adopt
      // listener below would have taken the handoff first, leaving nothing
      // here even though the window is perfectly alive.
      if (!(await claimHandoff.current()) && !claimedRef.current) setLost(true);
    })();
  }, [claimHandoff]);

  // Detaching while this window is already open parks a SECOND handoff
  // instead of building a window (commands/chat_window.rs) - this event is
  // how the window finds out. Without it that state was dropped: the window
  // kept showing its previous exchange while the Quick Ask bar that handed it
  // over had already hidden itself, leaving the edits it proposed with no
  // accept/reject surface at all.
  useEffect(() => {
    return unlistenAll(
      listenToThisWindow(CHAT_ADOPT_HANDOFF, () => {
        void claimHandoff.current();
      }),
    );
  }, [claimHandoff]);

  // A send parked waiting for a fresh context (see refreshContext below).
  // At most one: `send` refuses to start while another is in flight.
  const contextWaiter = useRef<((context: ChatContext) => void) | null>(null);

  const applyContext = useCallback((incoming: ChatContext) => {
    // The push doubles as "this editor is the one talking now", so the reply
    // address moves with the document rather than being tracked separately
    // and drifting out of step with it.
    if (incoming.editorLabel) editorLabel.current = incoming.editorLabel;
    setContext(incoming);
    const waiter = contextWaiter.current;
    contextWaiter.current = null;
    waiter?.(incoming);
  }, []);

  // The editor pushes a fresh document/selection whenever either changes, so
  // the window shows the file the user is actually in and every new
  // highlight becomes a new selection chip.
  useEffect(() => {
    return unlistenAll(
      onWindowEvent<ChatContext>(EDITOR_TO_CHAT.context, applyContext),
      // Merged, not replaced: each push carries only the ACTIVE tab's
      // statuses, and replacing dropped every other document's cards back to
      // an unknown state on each tab switch.
      onWindowEvent<Record<string, PendingStatus>>(
        EDITOR_TO_CHAT.statuses,
        (incoming) => setStatuses((prev) => ({ ...prev, ...incoming })),
      ),
    );
  }, [applyContext]);

  // Closing the window hands the conversation back so the editor can re-embed
  // the panel instead of silently losing the exchange. The window is
  // destroyed once this resolves, so it first waits for the storage writes
  // this window still has on their way (the conversation's history entry,
  // the pin setting) - see storage/pending-writes.ts.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested(async () => {
      if (editorLabel.current)
        sendToWindow(editorLabel.current, CHAT_TO_EDITOR.reembed, {
          conversationId: conversation.conversationId,
          turns: conversation.history,
          docPath:
            requestDocPath.current ?? contextRef.current?.docPath ?? null,
        });
      await flushPendingWrites();
    });
    return unlistenAll(unlisten);
  }, [conversation.conversationId, conversation.history]);

  // Pin: a chat the user keeps beside their writing is worth nothing if it
  // disappears behind the editor the moment they click into the document.
  // The setting (not window-local state) so it survives closing the window.
  const pinned = settings.pinAgentWindow;
  useEffect(() => {
    void getCurrentWindow().setAlwaysOnTop(pinned);
  }, [pinned]);

  // The title says which document this is currently about - the one piece of
  // "which file am I talking to" visible when the window is on another
  // monitor with the editor out of sight.
  const docTitle = context?.docTitle;
  useEffect(() => {
    void getCurrentWindow().setTitle(
      docTitle ? `${t.chatWindowTitle} - ${docTitle}` : t.chatWindowTitle,
    );
  }, [docTitle, t.chatWindowTitle]);

  const send = useCallback((event: string, payload?: unknown) => {
    if (editorLabel.current) sendToWindow(editorLabel.current, event, payload);
  }, []);

  /** Every doc-scoped message says which file it was meant for: this window
   *  serves several tabs, and the editor may have switched since. A request
   *  belongs to the document it was SENT about - recorded when its context
   *  arrives - and each proposal remembers it, so switching tabs while a
   *  reply streams can't send the rest of it (or a later Accept) elsewhere. */
  const docPath = context?.docPath ?? null;
  const contextRef = useRef(context);
  contextRef.current = context;
  const requestDocPath = useRef<string | null>(null);
  const proposalDocs = useRef(new Map<string, string | null>());
  const sendScoped = useCallback(
    (event: string, payload: object, scopedTo: string | null = docPath) =>
      send(event, { ...payload, docPath: scopedTo }),
    [send, docPath],
  );
  const sendForProposal = useCallback(
    (event: string, callId: string) =>
      sendScoped(
        event,
        { callId },
        proposalDocs.current.has(callId)
          ? (proposalDocs.current.get(callId) ?? null)
          : docPath,
      ),
    [sendScoped, docPath],
  );

  // A conversation picked from the history list waits here until the
  // editor has its document on screen: restored any earlier, its first save
  // would file it under whichever document the window was following. One
  // of a document never saved (or continued here) has nothing to wait for.
  const [reopening, setReopening] = useState<ChatRestore | null>(null);
  useEffect(() => {
    if (!reopening) return;
    if (reopening.docPath !== null && reopening.docPath !== docPath) return;
    setReopening(null);
    proposalDocs.current.clear();
    conversation.restore(reopening.id, reopening.turns);
  }, [reopening, docPath, conversation]);
  const reopenTarget: ReopenTarget = {
    restore: setReopening,
    openDocument: (path) =>
      send(CHAT_TO_EDITOR.openDocument, { path } satisfies OpenDocumentMessage),
  };

  /** Asks the active editor for its document/selection as they read right
   *  now, and resolves with the answer. See ChatBody's `refreshContext`. */
  const refreshContext = useCallback(
    () =>
      new Promise<ChatContext | null>((resolve) => {
        if (!editorLabel.current) return resolve(null);
        const timer = window.setTimeout(() => {
          contextWaiter.current = null;
          resolve(null);
        }, CONTEXT_REQUEST_TIMEOUT_MS);
        contextWaiter.current = (incoming) => {
          window.clearTimeout(timer);
          requestDocPath.current = incoming.docPath;
          resolve(incoming);
        };
        send(CHAT_TO_EDITOR.requestContext);
      }),
    [send],
  );

  const proposalStatus = useCallback(
    (callId: string): PendingStatus => statuses[callId] ?? "expired",
    [statuses],
  );
  const pendingCount = useMemo(
    () => Object.values(statuses).filter((s) => s === "pending").length,
    [statuses],
  );

  const labels = useMemo(
    () => chatLabels(t, settings.language),
    [t, settings.language],
  );

  // The window's top row, and the only chrome this view draws. It sits where
  // the title bar would be (see build_with_app_chrome), so it doubles as the
  // drag handle - without one, a window with no title bar of its own can't be
  // moved. Content is right-aligned so it clears the traffic lights on macOS
  // without a hardcoded platform-specific inset.
  //
  // On Windows there is no frame at all, so this row also carries the caption
  // - including the close button, which is what sends the conversation back
  // to the editor to be re-embedded.
  //
  // Rendered in EVERY state below, not just the loaded one. The two fallbacks
  // used to be bare full-height divs; on Windows that leaves a window with no
  // drag handle and no close button, so a chat whose handoff never arrived
  // (or whose editor went away) could not be moved or dismissed at all.
  const header = (
    <div className="chat-window-header" data-tauri-drag-region>
      <span className="chat-window-doc" title={context?.docPath ?? undefined}>
        {context?.docTitle ?? ""}
      </span>
      <ChatHistoryMenu
        buttonClassName="inline-chat-header-button"
        disabled={conversation.busy || !context}
        onReopen={(entry) => void reopenConversation(entry, t, reopenTarget)}
      />
      <Tooltip text={t.chatNewConversation}>
        <button
          type="button"
          className="inline-chat-header-button"
          aria-label={t.chatNewConversation}
          disabled={conversation.busy}
          onClick={() => {
            proposalDocs.current.clear();
            conversation.reset();
          }}
        >
          <PlusIcon />
        </button>
      </Tooltip>
      <Tooltip text={pinned ? t.chatWindowUnpinHint : t.chatWindowPinHint}>
        <button
          type="button"
          className={`inline-chat-header-button ${pinned ? "chat-window-pin-on" : ""}`}
          aria-pressed={pinned}
          aria-label={t.chatWindowPin}
          onClick={() => setSettings({ pinAgentWindow: !pinned })}
        >
          <PinIcon />
        </button>
      </Tooltip>
      <WindowCaptionButtons />
    </div>
  );

  // The history list's "document not found" question (app-dialog.tsx).
  const dialogs = <AppDialogHost okLabel={t.dialogOk} />;

  // Turned off - here or in any window - the conversation waits behind the
  // note, and comes back as it was once Textus AI is on again.
  if (!settings.textusAi)
    return (
      <div className="chat-window">
        {header}
        <TextusAiOffNote className="chat-window-ai-off" />
        {dialogs}
      </div>
    );
  if (lost)
    return (
      <div className="chat-window">
        {header}
        <div className="chat-window-lost">{t.chatWindowLost}</div>
        {dialogs}
      </div>
    );
  if (!claimed || !context)
    return (
      <div className="chat-window">
        {header}
        <div className="chat-window-loading">{t.agentThinking}</div>
        {dialogs}
      </div>
    );

  return (
    <div className="chat-window">
      {header}
      <div className="chat-window-body">
        <ChatBody
          document={context.document}
          selectedText={context.selectedText}
          selectionMarkdown={context.selectionMarkdown}
          docPath={context.docPath}
          workspaceRoot={settings.agentWorkspaceRoot || null}
          conversation={conversation}
          defaultMode={settings.agentDefaultMode}
          defaultWebSearch={settings.enableWebSearch}
          labels={labels}
          proposalStatus={proposalStatus}
          pendingCount={pendingCount}
          fillHeight
          refreshContext={refreshContext}
          onProposals={(
            proposals: { callId: string; proposal: EditProposal }[],
          ) => {
            const target = requestDocPath.current ?? docPath;
            for (const { callId } of proposals)
              proposalDocs.current.set(callId, target);
            sendScoped(CHAT_TO_EDITOR.proposals, { proposals }, target);
          }}
          onAcceptProposal={(callId) =>
            sendForProposal(CHAT_TO_EDITOR.accept, callId)
          }
          onRejectProposal={(callId) =>
            sendForProposal(CHAT_TO_EDITOR.reject, callId)
          }
          onAcceptAll={() => sendScoped(CHAT_TO_EDITOR.acceptAll, {})}
          onRejectAll={() => sendScoped(CHAT_TO_EDITOR.rejectAll, {})}
          selectionChip={{
            onChange: (chip) =>
              sendScoped(CHAT_TO_EDITOR.selectionChip, { chip }),
            onReveal: () => sendScoped(CHAT_TO_EDITOR.revealSelection, {}),
          }}
        />
      </div>
      {dialogs}
    </div>
  );
}
