import { describe, expect, it } from "vitest";
import { canSwitchModel, chatModel, modelChoices } from "./chat-models";
import type { ProviderCatalogEntry } from "../provider-catalog";

const entry = {
  id: "openai",
  agentDefaultModel: "gpt-6.1-sol",
  knownModels: ["gpt-6.1-sol", "gpt-6-luna"],
} as ProviderCatalogEntry;

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

  it("is a button only when there is another model to switch to", () => {
    const single = {
      id: "local",
      agentDefaultModel: "llama",
      knownModels: ["llama"],
    } as ProviderCatalogEntry;
    expect(canSwitchModel([single], {})).toBe(false);
    expect(canSwitchModel([], {})).toBe(false);
    expect(canSwitchModel([entry], {})).toBe(true);
    // One model each from two providers is still a choice.
    expect(
      canSwitchModel(
        [single, { ...single, id: "other" } as ProviderCatalogEntry],
        {},
      ),
    ).toBe(true);
  });
});
