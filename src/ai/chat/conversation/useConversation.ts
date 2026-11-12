import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useSettings } from "../../../prefs/SettingsContext";
import { useLatest } from "../../../utils/hooks/useLatest";
import {
  DRAFT,
  conversationScope,
  liveConversation,
  onLiveConversation,
} from "../conversation-scope";
import { ConversationModel, stopConversations } from "./conversation-model";
import { conversationFor } from "./conversation-registry";
import type {
  AgentConversation,
  ConversationEnv,
  ConversationPlace,
} from "./conversation-types";

/** `scope`'s live conversation, in every window; null where none was
 *  started, or for no scope. */
export function useLiveConversationId(scope: string | null): string | null {
  return useSyncExternalStore(
    (changed) => onLiveConversation(() => changed()),
    () => (scope ? liveConversation(scope) : null),
  );
}

/**
 * `model` as React reads it. Out of sight (`streaming` false) it changes
 * with the turns, not with every frame of a reply. Textus AI turned off -
 * here, in Settings or in another window - stops what is running.
 */
export function useConversation(
  model: ConversationModel,
  streaming = true,
): AgentConversation {
  const state = useSyncExternalStore(
    model.subscribe,
    streaming ? model.snapshot : model.settledSnapshot,
  );
  const aiOn = useSettings().settings.textusAi;
  useEffect(() => {
    if (!aiOn) stopConversations();
  }, [aiOn]);
  return useMemo(() => ({ ...state, ...model.actions }), [state, model]);
}

/**
 * The window's live conversation where the document at `docPath` is: its
 * folder's, or its own for a file opened alone. A new or reopened one is
 * that place's, whichever document is in front by then.
 */
export function useLiveConversation(
  docPath: string | null,
  workspaceRoot: string | null,
  streaming: boolean,
): AgentConversation {
  const scope = conversationScope(docPath, workspaceRoot);
  const live = useLiveConversationId(scope);
  const model = conversationFor(live ?? DRAFT, scope);
  const conversation = useConversation(model, streaming);
  return useMemo(() => {
    const place: ConversationPlace = { docPath, workspaceRoot };
    return {
      ...conversation,
      reset: (at = place) => model.reset(at),
      restore: (id, turns, at = place) => model.restore(id, turns, at),
    };
  }, [conversation, model, docPath, workspaceRoot]);
}

/**
 * A conversation of its surface's own, gone with it: Quick Ask's one-off
 * exchange (`persist` false keeps it out of History), Create's.
 */
export function useOwnConversation(
  env: () => ConversationEnv,
  persist = true,
): AgentConversation {
  const latest = useLatest(env);
  const [model] = useState(
    () => new ConversationModel({ env: () => latest.current(), persist }),
  );
  useEffect(() => () => model.dispose(), [model]);
  return useConversation(model);
}
