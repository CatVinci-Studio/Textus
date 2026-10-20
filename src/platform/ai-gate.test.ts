import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { AI_OFF, gateAiRequests } from "./ai-gate";
import { ai, auth, IpcError } from "./ipc";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
  Channel: class {
    onmessage: unknown = null;
  },
}));

const project = { docPath: null, workspaceRoot: null };

/** Every command that sends something to an AI service. */
const requests: [string, () => Promise<unknown>][] = [
  ["ai_complete", () => ai.complete("openai", "a", "", null, null)],
  ["ai_grammar_check", () => ai.grammarCheck("openai", "a", null, null)],
  [
    "ai_agent_message",
    () =>
      ai.agentMessage({
        provider: "openai",
        document: "",
        docPath: null,
        workspaceRoot: null,
        history: [],
        message: "hi",
        images: [],
        webSearch: false,
        mode: "review",
        model: null,
        requestId: "r",
      }),
  ],
  ["fetch_agent_models", () => ai.fetchAgentModels("openai")],
  [
    "learn_style",
    () =>
      ai.learnStyle({ provider: "openai", model: null, ...project, files: [] }),
  ],
  ["fetch_custom_models", () => auth.fetchCustomModels("http://x", null)],
  ["test_custom_endpoint", () => auth.testCustomEndpoint("http://x", null)],
];

describe("requests to an AI service", () => {
  afterEach(() => {
    gateAiRequests(() => true);
    vi.mocked(invoke).mockClear();
  });

  it.each(requests)(
    "%s never reaches Rust while Textus AI is off",
    async (command, send) => {
      gateAiRequests(() => false);
      const refused = await send().catch((err: unknown) => err);
      expect(refused).toBeInstanceOf(IpcError);
      expect((refused as IpcError).command).toBe(command);
      expect((refused as IpcError).cause).toBe(AI_OFF);
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it.each(requests)("%s goes out while it is on", async (command, send) => {
    await send();
    expect(invoke).toHaveBeenCalledWith(command, expect.anything());
  });

  it("are asked the switch as each one goes out, not once", async () => {
    let on = false;
    gateAiRequests(() => on);
    await expect(ai.fetchAgentModels("openai")).rejects.toThrow(AI_OFF);
    on = true;
    await ai.fetchAgentModels("openai");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
