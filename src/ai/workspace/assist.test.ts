import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ agentMessage: vi.fn() }));
vi.mock("../../platform/ipc", () => ({ ai: api }));
import {
  condenseImagePrompt,
  IMAGE_PROMPT_LIMIT,
  promptLength,
  refineImagePrompt,
} from "./assist";
import type { Settings } from "../../settings/SettingsContext";

const settings = {
  language: "zh",
  aiProvider: "custom",
  agentModels: {},
} as unknown as Settings;
const reply = (text: string) => [{ kind: "Assistant", text }];
beforeEach(() => api.agentMessage.mockReset());

it("condenses a rewrite that overshoots the image services' limit", async () => {
  api.agentMessage
    .mockResolvedValueOnce(reply("长".repeat(IMAGE_PROMPT_LIMIT + 300)))
    .mockResolvedValueOnce(reply("精简后的提示词"));
  const prompt = await refineImagePrompt(settings, {
    prompt: "原提示词",
    anchor: "段落",
    instruction: "参考86版西游记",
    history: [],
  });
  expect(prompt).toBe("精简后的提示词");
  expect(api.agentMessage).toHaveBeenCalledTimes(2);
});

it("falls back to cutting at a sentence when condensing still overshoots", async () => {
  api.agentMessage.mockResolvedValueOnce(reply("x".repeat(3000)));
  const long = `${"A calm scene. ".repeat(200)}`;
  const prompt = await condenseImagePrompt(settings, long);
  expect(promptLength(prompt)).toBeLessThanOrEqual(IMAGE_PROMPT_LIMIT);
  expect(prompt.endsWith(".")).toBe(true);
});
