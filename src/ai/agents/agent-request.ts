import type { ExternalAgent } from "../../plugins/contributions/agents";
import { getWindowAccess } from "../../plugins/app-bridge";
import { dirname } from "../../utils/path";
import type { StreamingState } from "../chat/stream-step";
import { thinkingDone, thinkingEvent } from "../chat/thought";
import type { AgentTurn } from "../types";
import { runAgentExchange } from "./agent-exchange";

/** A chat request id that stands for an external agent's exchange: stopped
 *  with `cancelAgentExchange`, not `ai_cancel`. */
export const AGENT_REQUEST = "agent:";

/** Where the agent works: the open folder, else the document's. */
export function agentFolder(
  workspaceRoot: string | null,
  docPath: string | null,
): string | null {
  return (
    workspaceRoot ??
    getWindowAccess()?.rootPath() ??
    (docPath ? dirname(docPath) : null)
  );
}

/** One message to `agent`, streamed into the chat as Textus AI's are. */
export function agentRequest(o: {
  agent: ExternalAgent;
  conversation: string;
  folder: string;
  docPath: string | null;
  message: string;
  get: () => StreamingState | null;
  set: (value: StreamingState, opts?: { textOnly?: boolean }) => void;
}): Promise<AgentTurn[]> {
  const prev = () => o.get() ?? { turns: [], text: "", thought: null };
  return runAgentExchange({
    agent: o.agent,
    conversation: o.conversation,
    cwd: o.folder,
    docPath: o.docPath,
    message: o.message,
    events: {
      view: (view) => {
        const now = prev();
        o.set(
          {
            ...now,
            turns: view.turns,
            text: view.text,
            thought: thinkingDone(now.thought, Date.now()),
          },
          { textOnly: view.turns === now.turns },
        );
      },
      thinking: (text) => {
        const now = prev();
        o.set(
          { ...now, thought: thinkingEvent(now.thought, text, Date.now()) },
          { textOnly: true },
        );
      },
      permission: (pending) => o.set({ ...prev(), permission: pending }),
    },
  });
}
