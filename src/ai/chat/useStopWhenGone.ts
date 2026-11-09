import { useEffect, type RefObject } from "react";
import { ai } from "../../platform/ipc";
import { useLatest } from "../../utils/hooks/useLatest";
import { AGENT_REQUEST } from "../agents/agent-request";
import { cancelAgentExchange, endAgentSession } from "../agents/agent-exchange";

/**
 * A conversation's request stops when nobody wants it any more: Textus AI
 * turned off (here, in Settings or in another window) stops it as Stop
 * would, keeping what has streamed; the editor that owns it going away (tab
 * closed, source mode) ends it, as nobody is left to show the reply.
 */
export function useStopWhenGone(
  aiOn: boolean,
  conversationId: string,
  requestId: RefObject<string | null>,
) {
  const conversation = useLatest(conversationId);
  useEffect(() => {
    const running = requestId.current;
    if (aiOn || !running) return;
    if (running.startsWith(AGENT_REQUEST))
      cancelAgentExchange(conversation.current);
    else void ai.cancelAgentMessage(running);
  }, [aiOn, conversation, requestId]);
  useEffect(
    () => () => {
      endAgentSession(conversation.current);
      if (requestId.current) void ai.cancelAgentMessage(requestId.current);
    },
    [conversation, requestId],
  );
}
