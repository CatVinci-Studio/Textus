import { afterEach, describe, expect, it, vi } from "vitest";

// An agent that answers everything but the prompt itself, and ignores
// being asked to cancel.
const ipc = vi.hoisted(() => ({
  stop: vi.fn(),
  /** session/new left unanswered: an agent still signing in. */
  slowStart: false,
  answers: [] as { id?: number; result?: unknown; error?: unknown }[],
  /** Options set, as "id=value". */
  set: [] as string[],
  /** What the user chose, as settings hold it. */
  chosen: {} as Record<string, Record<string, string>>,
  remote: null as (() => void) | null,
  /** The agent turns down a change of mode. */
  refuseMode: false,
  /** What session/new offers. */
  offered: undefined as unknown,
  out: null as ((o: { type: "lines"; lines: string[] }) => void) | null,
}));
vi.mock("../../platform/ipc-plugins", () => ({
  agentsIpc: {
    start: (_p: string, _a: string, _c: string, out: typeof ipc.out) => {
      ipc.out = out;
      return Promise.resolve(1);
    },
    send: (_h: number, line: string) => {
      const sent = JSON.parse(line) as { id?: number; method?: string };
      const { id, method } = sent;
      if (!method) return void ipc.answers.push(sent);
      if (method === "session/set_config_option") {
        const p = (sent as { params?: { configId: string; value: string } })
          .params!;
        ipc.set.push(`${p.configId}=${p.value}`);
      }
      if (id === undefined || method === "session/prompt") return;
      if (method === "session/new" && ipc.slowStart) return;
      if (
        method === "session/set_config_option" &&
        ipc.refuseMode &&
        (sent as { params?: { configId: string } }).params?.configId === "mode"
      )
        return queueMicrotask(() =>
          ipc.out!({
            type: "lines",
            lines: [
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                error: { code: -32602, message: "no" },
              }),
            ],
          }),
        );
      const result =
        method === "session/new"
          ? { sessionId: "s", configOptions: ipc.offered }
          : {};
      queueMicrotask(() =>
        ipc.out!({
          type: "lines",
          lines: [JSON.stringify({ jsonrpc: "2.0", id, result })],
        }),
      );
    },
    stop: ipc.stop,
  },
}));
vi.mock("../../platform/app-info", () => ({ appVersion: async () => "0" }));
vi.mock("../../prefs/settings-store", () => ({
  loadSettings: () => ({ agentOptions: ipc.chosen }),
  subscribeRemote: (fn: () => void) => {
    ipc.remote = fn;
    return () => {};
  },
}));
vi.mock("../../platform/ipc-files", () => ({ fs: {} }));
vi.mock("../chat/file-changes", () => ({ filesChanged: () => {} }));
vi.mock("../../plugins/app-bridge", () => ({
  getWindowAccess: () => null,
  openDocumentAt: () => null,
}));

import {
  agentRunning,
  cancelAgentExchange,
  fileUri,
  runAgentExchange,
} from "./agent-exchange";

describe("the document a prompt points at", () => {
  it("is a file: URI with its spaces and marks encoded", () => {
    expect(fileUri("/Users/me/Week45/Nov 8.md")).toBe(
      "file:///Users/me/Week45/Nov%208.md",
    );
    expect(fileUri("/a/#plan?.md")).toBe("file:///a/%23plan%3F.md");
    expect(fileUri("C:\\Notes\\周报.md")).toBe(
      "file:///C:/Notes/%E5%91%A8%E6%8A%A5.md",
    );
  });
});

describe("stopping an agent", () => {
  afterEach(() => vi.useRealTimers());

  it("ends one that keeps going after it was asked to stop", async () => {
    vi.useFakeTimers();
    const reply = runAgentExchange({
      agent: { key: "p/a", plugin: "p", id: "a", name: "A" } as never,
      conversation: "c",
      cwd: "/w",
      docPath: null,
      message: "hi",
      events: { view: () => {}, thinking: () => {}, permission: () => {} },
    });
    const settled = reply.then(
      () => "done",
      (err: { cause?: unknown }) => err.cause,
    );
    await vi.waitFor(() => expect(ipc.out).not.toBeNull());
    await vi.advanceTimersByTimeAsync(0);
    // A file outside the session's folder, or hidden in it, is refused.
    for (const [id, path] of [
      [90, "/etc/hosts"],
      [91, "/w/../etc/hosts"],
      [92, "/w/.textus/agent.md"],
    ] as const)
      ipc.out!({
        type: "lines",
        lines: [
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            method: "fs/read_text_file",
            params: { sessionId: "s", path },
          }),
        ],
      });
    await vi.advanceTimersByTimeAsync(0);
    expect(ipc.answers.map((a) => [a.id, !!a.error])).toEqual([
      [90, true],
      [91, true],
      [92, true],
    ]);
    cancelAgentExchange("c");
    await vi.advanceTimersByTimeAsync(4000);
    expect(ipc.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(ipc.stop).toHaveBeenCalledWith(1);
    // Ended as a stop, not as a failure to retry.
    expect(await settled).toBe("cancelled");
  });

  it("ends the exchange at once when stopped while the agent still starts", async () => {
    ipc.slowStart = true;
    const reply = runAgentExchange({
      agent: { key: "p/a", plugin: "p", id: "a", name: "A" } as never,
      conversation: "starting",
      cwd: "/w",
      docPath: null,
      message: "hi",
      events: { view: () => {}, thinking: () => {}, permission: () => {} },
    });
    const settled = reply.then(
      () => "done",
      (err: { cause?: unknown }) => err.cause,
    );
    await new Promise((done) => setTimeout(done, 0));
    cancelAgentExchange("starting");
    expect(await settled).toBe("cancelled");
    ipc.slowStart = false;
  });
});

describe("choices made in another window", () => {
  it("reach a running session, only the ones that changed", async () => {
    void runAgentExchange({
      agent: { key: "p/a", plugin: "p", id: "a", name: "A" } as never,
      conversation: "other",
      cwd: "/w",
      docPath: null,
      message: "hi",
      events: { view: () => {}, thinking: () => {}, permission: () => {} },
    });
    await vi.waitFor(() => expect(agentRunning("p/a")).toBe(true));
    ipc.set.length = 0;
    ipc.chosen = { "p/a": { model: "sonnet" } };
    ipc.remote!();
    await vi.waitFor(() => expect(ipc.set).toEqual(["model=sonnet"]));
    // Another setting changed (a theme): nothing is sent again.
    ipc.remote!();
    await new Promise((done) => setTimeout(done, 0));
    expect(ipc.set).toEqual(["model=sonnet"]);
  });

  it("a mode the agent refuses retires its session once the reply ends", async () => {
    ipc.offered = [
      {
        id: "mode",
        category: "mode",
        type: "select",
        currentValue: "default",
        options: [
          { value: "default", name: "Default" },
          { value: "bypass", name: "Bypass" },
        ],
      },
    ];
    ipc.chosen = { "p/r": { mode: "bypass" } };
    ipc.stop.mockClear();
    void runAgentExchange({
      agent: { key: "p/r", plugin: "p", id: "r", name: "R" } as never,
      conversation: "refusing",
      cwd: "/w",
      docPath: null,
      message: "hi",
      events: { view: () => {}, thinking: () => {}, permission: () => {} },
    });
    await vi.waitFor(() => expect(agentRunning("p/r")).toBe(true));
    ipc.refuseMode = true;
    ipc.chosen = { "p/r": { mode: "default" } };
    ipc.remote!();
    await vi.waitFor(() => expect(agentRunning("p/r")).toBe(false));
    // Its reply is still coming: the process isn't stopped under it.
    expect(ipc.stop).not.toHaveBeenCalled();
    ipc.refuseMode = false;
  });
});
