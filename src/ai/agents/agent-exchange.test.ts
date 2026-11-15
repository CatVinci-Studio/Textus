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
  /** session/new offers modes and models the older way (Gemini CLI). */
  older: null as null | { modes: unknown; models: unknown },
  out: null as ((o: { type: "lines"; lines: string[] }) => void) | null,
  /** It says it reads images. */
  images: false,
  /** The prompts sent, their blocks' types. */
  prompts: [] as string[][],
  /** Sign-in methods it lists; until one is run, session/new asks for it. */
  authMethods: null as null | { id: string }[],
  /** The sign-ins Textus ran. */
  authenticated: [] as string[],
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
      if (method === "session/set_mode" || method === "session/set_model") {
        const p = (sent as { params: Record<string, string> }).params;
        ipc.set.push(`${method}=${p.modeId ?? p.modelId}`);
      }
      if (method === "session/prompt")
        ipc.prompts.push(
          (
            sent as { params: { prompt: { type: string }[] } }
          ).params.prompt.map((block) => block.type),
        );
      if (id === undefined || method === "session/prompt") return;
      if (method === "session/new" && ipc.slowStart) return;
      if (method === "authenticate")
        ipc.authenticated.push(
          (sent as { params: { methodId: string } }).params.methodId,
        );
      if (
        method === "session/new" &&
        ipc.authMethods &&
        !ipc.authenticated.length
      )
        return queueMicrotask(() =>
          ipc.out!({
            type: "lines",
            lines: [
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                error: { code: -32000, message: "sign in" },
              }),
            ],
          }),
        );
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
          ? ipc.older
            ? { sessionId: "s", ...ipc.older }
            : { sessionId: "s", configOptions: ipc.offered }
          : method === "initialize"
            ? {
                ...(ipc.images && {
                  agentCapabilities: { promptCapabilities: { image: true } },
                }),
                ...(ipc.authMethods && { authMethods: ipc.authMethods }),
              }
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
  runAgentExchange,
} from "./agent-exchange";
import { fileUri } from "./agent-prompt";

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

describe("pictures attached to a message", () => {
  const send = (conversation: string) =>
    runAgentExchange({
      agent: { key: "p/pic", plugin: "p", id: "pic", name: "Pic" } as never,
      conversation,
      cwd: "/w",
      docPath: "/w/a.md",
      message: "what is this?",
      images: [{ name: "a.png", mime: "image/png", dataBase64: "AA==" }],
      events: { view: () => {}, thinking: () => {}, permission: () => {} },
    });

  it("reach an agent that reads them", async () => {
    ipc.images = true;
    ipc.prompts.length = 0;
    send("pictures-read").catch(() => undefined);
    await vi.waitFor(() =>
      expect(ipc.prompts).toEqual([["text", "resource_link", "image"]]),
    );
    cancelAgentExchange("pictures-read");
    ipc.images = false;
  });

  it("are refused, not dropped, for an agent that doesn't", async () => {
    ipc.prompts.length = 0;
    await expect(send("pictures-unread")).rejects.toThrow(/Pic/);
    expect(ipc.prompts).toEqual([]);
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

describe("an agent offering its mode and model the older way", () => {
  it("gets the user's choices with set_mode and set_model", async () => {
    ipc.older = {
      modes: {
        currentModeId: "default",
        availableModes: [
          { id: "default", name: "Default" },
          { id: "autoEdit", name: "Auto Edit" },
        ],
      },
      models: {
        currentModelId: "auto",
        availableModels: [
          { modelId: "auto", name: "Auto" },
          { modelId: "pro", name: "Pro" },
        ],
      },
    };
    ipc.chosen = { "p/g": { mode: "autoEdit", model: "pro" } };
    ipc.set.length = 0;
    const running = runAgentExchange({
      agent: { key: "p/g", plugin: "p", id: "g", name: "G" } as never,
      conversation: "older",
      cwd: "/w",
      docPath: null,
      message: "hi",
      events: { view: () => {}, thinking: () => {}, permission: () => {} },
    });
    running.catch(() => undefined);
    await vi.waitFor(() => expect(agentRunning("p/g")).toBe(true));
    expect(ipc.set.sort()).toEqual([
      "session/set_mode=autoEdit",
      "session/set_model=pro",
    ]);
    cancelAgentExchange("older");
    ipc.older = null;
  });
});

describe("choices made in another window", () => {
  it("reach a running session, only the ones that changed", async () => {
    const running = runAgentExchange({
      agent: { key: "p/a", plugin: "p", id: "a", name: "A" } as never,
      conversation: "other",
      cwd: "/w",
      docPath: null,
      message: "hi",
      events: { view: () => {}, thinking: () => {}, permission: () => {} },
    });
    // Ended as a stop: no reply to wait for.
    running.catch(() => undefined);
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
    const running = runAgentExchange({
      agent: { key: "p/r", plugin: "p", id: "r", name: "R" } as never,
      conversation: "refusing",
      cwd: "/w",
      docPath: null,
      message: "hi",
      events: { view: () => {}, thinking: () => {}, permission: () => {} },
    });
    // Ended as a stop: no reply to wait for.
    running.catch(() => undefined);
    await vi.waitFor(() => expect(agentRunning("p/r")).toBe(true));
    ipc.refuseMode = true;
    ipc.chosen = { "p/r": { mode: "default" } };
    ipc.remote!();
    await vi.waitFor(() => expect(agentRunning("p/r")).toBe(false));
    // Its reply is still coming: the process isn't stopped under it.
    expect(ipc.stop).not.toHaveBeenCalled();
    ipc.refuseMode = false;
    // Stop still reaches it: ended once its grace runs out.
    vi.useFakeTimers();
    cancelAgentExchange("refusing");
    await vi.advanceTimersByTimeAsync(5500);
    expect(ipc.stop).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("an agent with no mode that asks first (OpenCode)", () => {
  const request = (id: number) =>
    ipc.out!({
      type: "lines",
      lines: [
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "session/request_permission",
          params: {
            sessionId: "s",
            toolCall: { toolCallId: "t", title: "write a.txt" },
            options: [
              { optionId: "yes", name: "Allow", kind: "allow_once" },
              { optionId: "no", name: "Reject", kind: "reject_once" },
            ],
          },
        }),
      ],
    });

  it("asks the user, and with Allow all chosen Textus answers for them", async () => {
    ipc.offered = [
      {
        id: "mode",
        category: "mode",
        type: "select",
        currentValue: "build",
        options: [
          { value: "build", name: "build" },
          { value: "plan", name: "plan" },
        ],
      },
    ];
    ipc.chosen = {};
    const permission = vi.fn();
    const running = runAgentExchange({
      agent: { key: "p/o", plugin: "p", id: "o", name: "O" } as never,
      conversation: "opencode",
      cwd: "/w",
      docPath: null,
      message: "hi",
      events: { view: () => {}, thinking: () => {}, permission },
    });
    running.catch(() => undefined);
    await vi.waitFor(() => expect(agentRunning("p/o")).toBe(true));
    request(901);
    await vi.waitFor(() => expect(permission).toHaveBeenCalled());

    ipc.chosen = { "p/o": { "textus-approval": "allow" } };
    ipc.answers.length = 0;
    request(902);
    await vi.waitFor(() =>
      expect(ipc.answers).toContainEqual(
        expect.objectContaining({
          id: 902,
          result: { outcome: { outcome: "selected", optionId: "yes" } },
        }),
      ),
    );
    cancelAgentExchange("opencode");
  });

  it("names the step a request gives only by id, from what the agent said of it (DeepSeek)", async () => {
    ipc.offered = undefined;
    ipc.chosen = {};
    const permission = vi.fn();
    const running = runAgentExchange({
      agent: { key: "p/d", plugin: "p", id: "d", name: "D" } as never,
      conversation: "deepseek",
      cwd: "/w",
      docPath: null,
      message: "hi",
      events: { view: () => {}, thinking: () => {}, permission },
    });
    running.catch(() => undefined);
    await vi.waitFor(() => expect(agentRunning("p/d")).toBe(true));
    ipc.out!({
      type: "lines",
      lines: [
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "s",
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "b1",
              title: "bash",
              kind: "execute",
              rawInput: { command: "rm -rf build && npm test" },
            },
          },
        }),
        JSON.stringify({
          jsonrpc: "2.0",
          id: 903,
          method: "session/request_permission",
          params: {
            sessionId: "s",
            toolCall: { toolCallId: "b1" },
            options: [{ optionId: "yes", name: "Allow", kind: "allow_once" }],
          },
        }),
      ],
    });
    await vi.waitFor(() =>
      expect(permission).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "execute",
          detail: "rm -rf build && npm test",
        }),
      ),
    );
    cancelAgentExchange("deepseek");
  });
});

describe("an agent that asks to be signed in", () => {
  const start = (agent: Record<string, unknown>) =>
    runAgentExchange({
      agent: { key: "p/a", plugin: "p", id: "a", name: "A", ...agent } as never,
      conversation: `sign-${Math.random()}`,
      cwd: "/w",
      docPath: "/w/a.md",
      message: "hi",
      images: [],
      events: { view: () => {}, thinking: () => {}, permission: () => {} },
    });
  afterEach(() => {
    ipc.authMethods = null;
    ipc.authenticated = [];
  });

  it("is signed in the way its plugin names, not the first it lists (Codex)", async () => {
    ipc.authMethods = [{ id: "api-key" }, { id: "chat-gpt" }];
    void start({ signIn: "chat-gpt" }).catch(() => {});
    await vi.waitFor(() => expect(ipc.authenticated).toEqual(["chat-gpt"]));
  });

  it("is left to its setup when its plugin names none (Qwen)", async () => {
    ipc.authMethods = [{ id: "openai" }];
    await expect(start({ signIn: "" })).rejects.toBeTruthy();
    expect(ipc.authenticated).toEqual([]);
  });
});
