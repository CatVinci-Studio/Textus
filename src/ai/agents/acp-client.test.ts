import { describe, expect, it, vi } from "vitest";
import {
  AcpConnection,
  AcpError,
  AUTH_REQUIRED,
  type AcpClient,
} from "./acp-client";

function connect(client: Partial<AcpClient> = {}) {
  const sent: Record<string, unknown>[] = [];
  const connection = new AcpConnection(
    {
      send: async (line) => void sent.push(JSON.parse(line)),
      stop: vi.fn(),
    },
    {
      update: vi.fn(),
      requestPermission: vi.fn(),
      readTextFile: vi.fn(),
      writeTextFile: vi.fn(),
      ...client,
    },
  );
  return { connection, sent };
}

describe("AcpConnection", () => {
  it("answers a request with its result, and an error with its code", async () => {
    const { connection, sent } = connect();
    const opened = connection.request("session/new", { cwd: "/w" });
    await Promise.resolve();
    connection.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        id: sent[0].id,
        result: { sessionId: "s" },
      }),
    );
    await expect(opened).resolves.toEqual({ sessionId: "s" });

    const prompt = connection.request("session/prompt", {});
    await Promise.resolve();
    connection.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        id: sent[1].id,
        error: { code: AUTH_REQUIRED, message: "Authentication required" },
      }),
    );
    await expect(prompt).rejects.toMatchObject({ code: AUTH_REQUIRED });
    await expect(prompt).rejects.toBeInstanceOf(AcpError);
  });

  it("hears updates and serves the agent's requests, refusing what it doesn't offer", async () => {
    const update = vi.fn();
    const readTextFile = vi.fn(async () => ({ content: "# Doc" }));
    const { connection, sent } = connect({ update, readTextFile });
    connection.receive("a log line, not JSON");
    connection.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "s",
          update: { sessionUpdate: "plan", entries: [] },
        },
      }),
    );
    expect(update).toHaveBeenCalledOnce();
    connection.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "fs/read_text_file",
        params: { sessionId: "s", path: "/w/a.md" },
      }),
    );
    connection.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 8,
        method: "terminal/create",
        params: {},
      }),
    );
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent).toContainEqual({
      jsonrpc: "2.0",
      id: 7,
      result: { content: "# Doc" },
    });
    expect(sent.find((m) => m.id === 8)).toMatchObject({
      error: { code: -32601 },
    });
  });

  it("fails every waiting call when the agent goes away", async () => {
    const { connection } = connect();
    const waiting = connection.request("session/prompt", {});
    connection.close(new Error("Claude Agent stopped."));
    await expect(waiting).rejects.toThrow("Claude Agent stopped.");
    await expect(connection.request("session/new", {})).rejects.toThrow(
      "stopped",
    );
  });
});
