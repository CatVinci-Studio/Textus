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
import type { Settings } from "../../../settings/SettingsContext";

/**
 * The chat window's side of a detach (ChatWindowApp): the handoff it was
 * created for - and any later one parked for it - taken on; the editor's
 * pushes of its document, selection and proposal statuses; and which
 * editor it is talking to now.
 */
export function useChatWindowHandoff(settings: Settings) {
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

  // Edit › Select All in this window too: macOS's menu sends it to the
  // focused window, the composer's text here (app/menu/app-menu-actions.ts).
  useEffect(
    () => unlistenAll(listenToThisWindow("menu-select-all", selectAllInFocus)),
    [],
  );

  // A send parked waiting for a fresh context (useChatWindowBridge's
  // refreshContext). At most one: `send` refuses to start while another is
  // in flight.
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
