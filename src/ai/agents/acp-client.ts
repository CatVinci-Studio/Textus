/**
 * The window's side of the Agent Client Protocol (agentclientprotocol.com):
 * JSON-RPC 2.0, a message a line, with an agent started by Rust
 * (`agent_start`). Textus is the client: it opens a session, sends prompts,
 * hears the session's updates, and answers what the agent asks of it -
 * permission for a step, a file read or written.
 */

export const PROTOCOL_VERSION = 1;

/** What the agent asks of the client, and what hears its updates. */
export interface AcpClient {
  update(params: { sessionId: string; update: SessionUpdate }): void;
  requestPermission(params: PermissionRequest): Promise<PermissionOutcome>;
  readTextFile(params: {
    path: string;
    line?: number | null;
    limit?: number | null;
  }): Promise<{ content: string }>;
  writeTextFile(params: { path: string; content: string }): Promise<null>;
}

/** A line out and the end of the process, as Rust gives them. */
interface AcpTransport {
  send(line: string): Promise<void>;
  stop(): void;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "resource_link"; uri: string; name: string; mimeType?: string }
  | { type: string; [key: string]: unknown };

export interface ToolCallFields {
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: "pending" | "in_progress" | "completed" | "failed";
  content?: { type: string; content?: ContentBlock; path?: string }[] | null;
  locations?: { path: string; line?: number | null }[] | null;
}

export type SessionUpdate =
  | { sessionUpdate: "agent_message_chunk"; content: ContentBlock }
  | { sessionUpdate: "agent_thought_chunk"; content: ContentBlock }
  | { sessionUpdate: "user_message_chunk"; content: ContentBlock }
  | ({ sessionUpdate: "tool_call" } & ToolCallFields)
  | ({ sessionUpdate: "tool_call_update" } & ToolCallFields)
  | {
      sessionUpdate: "plan";
      entries: { content: string; status: string; priority?: string }[];
    }
  | { sessionUpdate: string; [key: string]: unknown };

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

export interface PermissionRequest {
  sessionId: string;
  toolCall: ToolCallFields;
  options: PermissionOption[];
}

export type PermissionOutcome = {
  outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
};

/** An error the agent answered with; `code` -32000 asks the user to sign in. */
export class AcpError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

export const AUTH_REQUIRED = -32000;

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class AcpConnection {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private closed: Error | null = null;

  constructor(
    private readonly transport: AcpTransport,
    private readonly client: AcpClient,
  ) {}

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.closed) return Promise.reject(this.closed);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.transport
        .send(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
        .catch((err: unknown) => {
          this.pending.delete(id);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.closed)
      void this.transport
        .send(JSON.stringify({ jsonrpc: "2.0", method, params }))
        .catch(() => {});
  }

  /** One line the agent wrote. */
  receive(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line);
    } catch {
      return; // A log line on stdout, not a message.
    }
    const { id, method } = message;
    if (typeof method === "string") {
      if (id === undefined || id === null)
        this.onNotification(method, message.params);
      else void this.answer(id, method, message.params);
      return;
    }
    if (typeof id !== "number") return;
    const waiting = this.pending.get(id);
    if (!waiting) return;
    this.pending.delete(id);
    const error = message.error as
      { code?: number; message?: string; data?: unknown } | undefined;
    if (error)
      waiting.reject(
        new AcpError(
          error.message ?? "The agent refused.",
          error.code ?? 0,
          error.data,
        ),
      );
    else waiting.resolve(message.result ?? null);
  }

  /** The agent is gone: every call still waiting fails with `why`. */
  close(why: Error): void {
    this.closed = why;
    for (const { reject } of this.pending.values()) reject(why);
    this.pending.clear();
  }

  stop(): void {
    this.close(new Error("The agent was stopped."));
    this.transport.stop();
  }

  private onNotification(method: string, params: unknown) {
    if (method === "session/update")
      this.client.update(
        params as { sessionId: string; update: SessionUpdate },
      );
  }

  private async answer(id: unknown, method: string, params: unknown) {
    const reply = (body: Record<string, unknown>) =>
      void this.transport
        .send(JSON.stringify({ jsonrpc: "2.0", id, ...body }))
        .catch(() => {});
    const handlers: Record<string, (p: never) => Promise<unknown>> = {
      "session/request_permission": (p: PermissionRequest) =>
        this.client.requestPermission(p),
      "fs/read_text_file": (p: { path: string }) => this.client.readTextFile(p),
      "fs/write_text_file": (p: { path: string; content: string }) =>
        this.client.writeTextFile(p),
    };
    const handler = handlers[method];
    if (!handler)
      return reply({
        error: { code: -32601, message: `Textus doesn't offer ${method}.` },
      });
    try {
      reply({ result: (await handler(params as never)) ?? null });
    } catch (err) {
      reply({
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
}

/** The client capabilities Textus offers: files through the window, so an
 *  open document is read and changed as the editor has it; no terminal. */
export const CLIENT_CAPABILITIES = {
  fs: { readTextFile: true, writeTextFile: true },
  terminal: false,
};
