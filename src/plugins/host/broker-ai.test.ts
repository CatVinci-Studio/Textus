import { describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  aiStatus: vi.fn(async () => ({
    on: true,
    allowed: false,
    used: 0,
    limit: 100000,
  })),
  aiAllow: vi.fn(async () => null),
  aiComplete: vi.fn(),
}));
vi.mock("../../platform/ipc", () => ({ plugins: ipc }));
const confirm = vi.hoisted(() => vi.fn());
vi.mock("../../engine/controls/app-dialog", () => ({ showConfirm: confirm }));

import en from "../../i18n/locales/en";
import { aiModelHandlers, promptOf } from "./broker-ai";
import type { PluginScope } from "./broker-scope";

const scope = {
  id: "a.translate",
  name: () => "Translate",
  t: () => en,
} as unknown as PluginScope;

describe("a plugin asking the user's AI model", () => {
  it("sends one question as it is, a conversation as turns", () => {
    expect(promptOf("Hi")).toBe("Hi");
    expect(
      promptOf([
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
        { role: "user", content: "Again" },
      ]),
    ).toBe("User: Hi\n\nAssistant: Hello\n\nUser: Again\n\nAssistant:");
    expect(() => promptOf([{ role: "system", content: "x" }])).toThrow();
  });

  it("asks the user on the first call, then asks the model", async () => {
    ipc.aiComplete
      .mockRejectedValueOnce("plugin-ai-not-allowed")
      .mockResolvedValueOnce("Bonjour");
    confirm.mockResolvedValueOnce(true);
    const complete = aiModelHandlers(scope)["ai.complete"];
    await expect(
      complete({ system: "Translate to French.", messages: "Hello" }),
    ).resolves.toBe("Bonjour");
    expect(confirm.mock.calls[0][0]).toContain("Translate wants to use");
    expect(ipc.aiAllow).toHaveBeenCalledWith("a.translate", false);
  });

  it("stops when the user says no, and asks for more at the limit", async () => {
    ipc.aiComplete.mockRejectedValueOnce("plugin-ai-limit");
    confirm.mockResolvedValueOnce(false);
    const complete = aiModelHandlers(scope)["ai.complete"];
    await expect(complete({ messages: "Hello" })).rejects.toThrow(
      "didn't allow",
    );
    expect(confirm.mock.calls.at(-1)?.[0]).toContain("Allow 100,000 more?");
  });
});
