import { describe, expect, it } from "vitest";
import { aiFeatures } from "./textus-ai";

const all = {
  textusAi: true,
  enableCompletion: true,
  enableGrammarCheck: true,
  enableAskAi: true,
};

describe("aiFeatures", () => {
  it("offers each feature turned on while Textus AI is on", () => {
    expect(aiFeatures(all)).toEqual({
      on: true,
      completion: true,
      grammar: true,
      chat: true,
    });
    expect(
      aiFeatures({ ...all, enableCompletion: false, enableAskAi: false }),
    ).toEqual({ on: true, completion: false, grammar: true, chat: false });
  });

  it("offers nothing while Textus AI is off, whatever the features say", () => {
    expect(aiFeatures({ ...all, textusAi: false })).toEqual({
      on: false,
      completion: false,
      grammar: false,
      chat: false,
    });
  });

  it("offers the tour its conversation with chat off, but not with Textus AI off", () => {
    const chatOff = { ...all, enableAskAi: false };
    expect(aiFeatures(chatOff, true).chat).toBe(true);
    expect(aiFeatures({ ...chatOff, textusAi: false }, true).chat).toBe(false);
  });
});
