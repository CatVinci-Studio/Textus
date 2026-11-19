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

/** An error as the user can act on it: sign in, or, for one it gave
 *  while `starting`, install. The agent's own reason comes before its
 *  error's generic title ("Internal error"). */
export function explain(
  agent: ExternalAgent,
  err: unknown,
  starting = false,
): Error {
  if (err instanceof AcpError && err.code === AUTH_REQUIRED)
    return new Error(
      [fill(currentStrings().agentSignIn, { agent: agent.name }), agent.setup]
        .filter(Boolean)
        .join("\n\n"),
    );
  const message =
    reasonIn(err) ??
    (err instanceof Error ? err.message : String(err)).replace(
      /^Internal error: /,
      "",
    );
  return new Error(
    starting && agent.setup && !message.includes(agent.setup)
      ? `${message}\n\n${agent.setup}`
      : message,
  );
}

/** Where agents put why they stopped: Codex in `message`, Claude and
 *  Qwen in `details`, a server's body in `error.message`. */
function reasonIn(err: unknown): string | undefined {
  if (!(err instanceof AcpError) || typeof err.data !== "object") return;
  const data = err.data as {
    message?: unknown;
    details?: unknown;
    error?: { message?: unknown };
  } | null;
  const reason = data?.message ?? data?.details ?? data?.error?.message;
  return typeof reason === "string" && reason.trim()
    ? reason.trim()
    : undefined;
}
