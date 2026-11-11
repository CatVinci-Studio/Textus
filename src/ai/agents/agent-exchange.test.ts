import { afterEach, describe, expect, it, vi } from "vitest";

// An agent that answers everything but the prompt itself, and ignores
// being asked to cancel.
const ipc = vi.hoisted(() => ({
  stop: vi.fn(),
  out: null as ((o: { type: "line"; text: string }) => void) | null,
}));
vi.mock("../../platform/ipc-plugins", () => ({
  agentsIpc: {
    start: (_p: string, _a: string, _c: string, out: typeof ipc.out) => {
      ipc.out = out;
      return Promise.resolve(1);
    },
    send: (_h: number, line: string) => {
      const { id, method } = JSON.parse(line) as {
        id?: number;
        method: string;
      };
      if (id === undefined || method === "session/prompt") return;
      const result = method === "session/new" ? { sessionId: "s" } : {};
      queueMicrotask(() =>
        ipc.out!({
          type: "line",
          text: JSON.stringify({ jsonrpc: "2.0", id, result }),
        }),
      );
    },
    stop: ipc.stop,
  },
}));
vi.mock("../../platform/app-info", () => ({ appVersion: async () => "0" }));
vi.mock("../../platform/ipc-files", () => ({ fs: {} }));
vi.mock("../chat/file-changes", () => ({ filesChanged: () => {} }));
vi.mock("../../plugins/app-bridge", () => ({
  getWindowAccess: () => null,
  openDocumentAt: () => null,
}));

import {
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
      () => "ended",
    );
    await vi.waitFor(() => expect(ipc.out).not.toBeNull());
    await vi.advanceTimersByTimeAsync(0);
    cancelAgentExchange("c");
    await vi.advanceTimersByTimeAsync(4000);
    expect(ipc.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(ipc.stop).toHaveBeenCalledWith(1);
    expect(await settled).toBe("ended");
  });
});
