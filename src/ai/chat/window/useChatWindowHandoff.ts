import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentConversation } from "../useAgentConversation";
import type { PendingStatus } from "../../revision/usePendingEdits";
import {
  CHAT_ADOPT_HANDOFF,
  EDITOR_TO_CHAT,
  onWindowEvent,
  type ChatContext,
} from "./chat-bridge";
import { windowIpc } from "../../../platform/ipc";
import { listenToThisWindow, unlistenAll } from "../../../platform/events";
import { selectAllInFocus } from "../../../ui/select-all";
import { useLatest } from "../../../utils/hooks/useLatest";
import type { Settings } from "../../../prefs/SettingsContext";

/**
 * The chat window's side of a detach: the handoffs it takes on, the editor's
 * pushes of document, selection and proposal statuses, and which editor it
 * is talking to now.
 */
export function useChatWindowHandoff(settings: Settings) {
  const [context, setContext] = useState<ChatContext | null>(null);
  const [statuses, setStatuses] = useState<Record<string, PendingStatus>>({});
  const [lost, setLost] = useState(false);
  // The editor currently being talked to, read inside callbacks that outlive
  // a render. Every context push re-points it, so one window serves several
  // documents.
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
   * Claims the handoff parked under this window's label (destructive). Through
   * a ref: `conversation` is fresh each render and both callers subscribe once.
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

  // Claim the handoff this window was created for. Once-only: StrictMode
  // double-runs mount effects in dev.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void (async () => {
      // Nothing to carry on from: the editor went away before this mounted.
      // `claimedRef` covers a detach adopted by the listener below while this
      // claim was in flight.
      if (!(await claimHandoff.current()) && !claimedRef.current) setLost(true);
    })();
  }, [claimHandoff]);

  // Detaching while this window is already open parks a second handoff
  // instead of building a window; this event is how the window finds out.
  useEffect(() => {
    return unlistenAll(
      listenToThisWindow(CHAT_ADOPT_HANDOFF, () => {
        void claimHandoff.current();
      }),
    );
  }, [claimHandoff]);

  // Edit › Select All in this window too: macOS's menu sends it to the
  // focused window.
  useEffect(
    () => unlistenAll(listenToThisWindow("menu-select-all", selectAllInFocus)),
    [],
  );

  // A send parked waiting for a fresh context. At most one: `send` refuses to
  // start while another is in flight.
  const contextWaiter = useRef<((context: ChatContext) => void) | null>(null);

  const applyContext = useCallback((incoming: ChatContext) => {
    // The push doubles as "this editor is the one talking now", so the reply
    // address moves with the document.
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
      // Merged, not replaced: each push carries only the active tab's
      // statuses.
      onWindowEvent<Record<string, PendingStatus>>(
        EDITOR_TO_CHAT.statuses,
        (incoming) => setStatuses((prev) => ({ ...prev, ...incoming })),
      ),
    );
  }, [applyContext]);

  return {
    context,
    statuses,
    lost,
    claimed,
    editorLabel,
    conversation,
    contextWaiter,
  };
}

export type ChatWindowHandoff = ReturnType<typeof useChatWindowHandoff>;
