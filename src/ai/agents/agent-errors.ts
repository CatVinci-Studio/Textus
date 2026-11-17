import { fill } from "../../i18n/fill";
import { currentStrings } from "../../i18n/current";
import type { ExternalAgent } from "../../plugins/contributions/agents";
import { AcpError, AUTH_REQUIRED } from "./acp-client";

/** What an agent's failure says to the user: why it stopped, and what to do. */

export function stoppedText(agent: ExternalAgent, stderr: string): string {
  const tail = stderr.trim().split("\n").slice(-4).join("\n");
  return [
    fill(currentStrings().agentStopped, { agent: agent.name }),
    tail,
    agent.setup,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** An error as the user can act on it: sign in, or install. */
export function explain(agent: ExternalAgent, err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof AcpError && err.code === AUTH_REQUIRED)
    return new Error(
      [fill(currentStrings().agentSignIn, { agent: agent.name }), agent.setup]
        .filter(Boolean)
        .join("\n\n"),
    );
  return new Error(
    agent.setup && !message.includes(agent.setup)
      ? `${message}\n\n${agent.setup}`
      : message,
  );
}
