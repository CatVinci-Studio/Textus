/**
 * A scripted external agent for the browser shim (e2e): it speaks the Agent
 * Client Protocol as Claude Agent or Codex would, through the commands Rust
 * offers (`agent_start`, `agent_send`, `agent_stop`). A prompt reads the
 * document it names, says so, asks to edit it, and appends a line once
 * allowed.
 */

type Message = Record<string, unknown> & { id?: number; method?: string };

let output: { onmessage?: (out: unknown) => void } | undefined;
let nextId = 1000;
const waiting = new Map<number, (result: unknown) => void>();
let promptId: number | null = null;

function emit(message: Message) {
  output?.onmessage?.({
    type: "line",
    text: JSON.stringify({ jsonrpc: "2.0", ...message }),
  });
}

function ask(method: string, params: unknown): Promise<unknown> {
  const id = nextId++;
  emit({ id, method, params });
  return new Promise((resolve) => waiting.set(id, resolve));
}

function update(update: Record<string, unknown>) {
  emit({ method: "session/update", params: { sessionId: "s1", update } });
}

const say = (text: string) =>
  update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  });

async function prompt(
  id: number,
  params: { prompt: { type: string; uri?: string }[] },
) {
  promptId = id;
  const link = params.prompt.find((b) => b.type === "resource_link");
  const path = link?.uri?.replace(/^file:\/\//, "") ?? "";
  const read = (await ask("fs/read_text_file", { sessionId: "s1", path })) as {
    content: string;
  };
  say(`Read ${read.content.split("\n").length} lines.`);
  update({
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    title: "Edit a.md",
    kind: "edit",
    status: "pending",
  });
  const answer = (await ask("session/request_permission", {
    sessionId: "s1",
    toolCall: { toolCallId: "t1", title: "Edit a.md" },
    options: [
      { optionId: "yes", name: "Allow", kind: "allow_once" },
      { optionId: "no", name: "Reject", kind: "reject_once" },
    ],
  })) as { outcome: { outcome: string; optionId?: string } };
  if (promptId !== id) return;
  const allowed = answer.outcome.optionId === "yes";
  if (allowed)
    await ask("fs/write_text_file", {
      sessionId: "s1",
      path,
      content: `${read.content}\n\nAdded by the agent.`,
    });
  update({
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    status: allowed ? "completed" : "failed",
  });
  say(allowed ? "Done." : "Skipped.");
  promptId = null;
  emit({ id, result: { stopReason: "end_turn" } });
}

function receive(message: Message) {
  if (message.method === undefined && typeof message.id === "number") {
    waiting.get(message.id)?.(message.result);
    waiting.delete(message.id);
    return;
  }
  const { id, method } = message;
  if (method === "initialize")
    emit({
      id,
      result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] },
    });
  else if (method === "session/new") emit({ id, result: { sessionId: "s1" } });
  else if (method === "session/prompt")
    void prompt(id!, message.params as never);
  else if (method === "session/cancel" && promptId !== null) {
    emit({ id: promptId, result: { stopReason: "cancelled" } });
    promptId = null;
  }
}

/** The answer to one of the agent commands. */
export function agentShim(cmd: string, args: Record<string, unknown>): unknown {
  ((window as unknown as { __devAgentCalls?: unknown[] }).__devAgentCalls ??=
    []).push({
    cmd,
    ...args,
  });
  if (cmd === "agent_start") {
    output = args.onOutput as typeof output;
    return 1;
  }
  if (cmd === "agent_send") receive(JSON.parse(args.line as string));
  return null;
}
