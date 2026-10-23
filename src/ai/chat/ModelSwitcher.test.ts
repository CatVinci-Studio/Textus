import { describe, expect, it } from "vitest";
import { chatModel, modelChoices } from "./ModelSwitcher";
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
});
