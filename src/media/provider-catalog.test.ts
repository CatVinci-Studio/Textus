import { expect, it } from "vitest";
import { mediaPresets, mediaProviderDefaults } from "./provider-catalog";
it("only exposes implemented capability combinations", () => {
  expect(mediaPresets("image").map((p) => p.id)).not.toContain("elevenlabs");
  expect(mediaPresets("stt").map((p) => p.id)).not.toContain("gemini");
  expect(mediaPresets("tts").map((p) => p.id)).not.toContain("volcengine");
});
it("sets clean system defaults and resets credentials on provider switching", () => {
  expect(mediaProviderDefaults("system", "stt")).toMatchObject({
    endpoint: "",
    model: "system",
    voice: null,
    credentialSource: "separate",
  });
  expect(() => mediaProviderDefaults("system", "tts")).toThrow();
  expect(mediaProviderDefaults("openai", "tts")).toMatchObject({
    voice: "alloy",
    playbackRate: 1,
    language: null,
  });
});
