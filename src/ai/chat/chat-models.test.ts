import { describe, expect, it } from "vitest";
import { canSwitchModel, chatModel, modelChoices } from "./chat-models";
import type { ProviderCatalogEntry } from "../provider-catalog";

const entry = {
  id: "openai",
  agentDefaultModel: "gpt-6.1-sol",
  knownModels: ["gpt-6.1-sol", "gpt-6-luna"],
} as unknown as ProviderCatalogEntry;

describe("the composer's model", () => {
  it("is the one chosen for the provider, else its default", () => {
    expect(chatModel(entry, {})).toBe("gpt-6.1-sol");
    expect(chatModel(entry, { openai: "gpt-6-luna" })).toBe("gpt-6-luna");
    expect(chatModel(entry, { openai: "" })).toBe("gpt-6.1-sol");
  });

  it("offers the one in use first, then the rest, each once", () => {
    expect(modelChoices(entry, { openai: "my-model" })).toEqual([
      "my-model",
      "gpt-6.1-sol",
      "gpt-6-luna",
    ]);
    expect(modelChoices(entry, {})).toEqual(["gpt-6.1-sol", "gpt-6-luna"]);
  });

  it("offers a local provider's installed models, never one since removed", () => {
    const ollama = {
      id: "ollama",
      agentDefaultModel: null,
      knownModels: [],
    } as unknown as ProviderCatalogEntry;
    const chosen = { ollama: "llama-old" };
    // Not in use: what was fetched, not the model picked there once.
    expect(modelChoices(ollama, chosen, [], false)).toEqual([]);
    expect(modelChoices(ollama, chosen, ["qwen"], false)).toEqual(["qwen"]);
    // In use: the model it runs, and what is installed.
    expect(modelChoices(ollama, chosen, ["qwen"], true)).toEqual([
      "llama-old",
      "qwen",
    ]);
  });

  it("is a button only when there is another model to switch to", () => {
    expect(canSwitchModel([{ models: ["llama"] }])).toBe(false);
    expect(canSwitchModel([])).toBe(false);
    expect(canSwitchModel([{ models: ["a", "b"] }])).toBe(true);
    // One model each from two providers is still a choice.
    expect(canSwitchModel([{ models: ["a"] }, { models: ["b"] }])).toBe(true);
  });
});
