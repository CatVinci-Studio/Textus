import { describe, expect, it } from "vitest";
import { PROVIDER_CATALOG } from "../platform/bindings/ai";
import type { ProviderCatalogEntry } from "./provider-catalog";
import { isCustomId, withCustomEndpoints } from "./custom-endpoints";
import { localizedLabel } from "./provider-connection";
import { chatModel } from "./chat/chat-models";
import { settingsWithout } from "../settings/sections/custom-provider-form";
import { resolveStrings } from "../i18n/strings";

const catalog = PROVIDER_CATALOG as readonly ProviderCatalogEntry[];
const endpoint = (id: string, name: string, base_url: string) => ({
  id,
  name,
  base_url,
  has_api_key: true,
  model: "gpt-6-luna",
});

describe("custom endpoints in the provider lists", () => {
  it("are each a provider of their own, named, in place of the one custom entry", () => {
    const list = withCustomEndpoints(catalog, [
      // Migrated from the single endpoint: no name, the old id.
      endpoint("custom", "", "https://relay-a.example/v1"),
      endpoint("custom:b1", "Relay B", "https://relay-b.example/v1"),
    ]);
    const custom = list.filter((e) => e.auth.includes("custom"));
    expect(custom.map((e) => e.id)).toEqual(["custom", "custom:b1"]);
    const t = resolveStrings("en");
    expect(custom.map((e) => localizedLabel(e, t))).toEqual([
      "relay-a.example",
      "Relay B",
    ]);
    // The same model on two relays is chosen per relay.
    const chosen = { custom: "gpt-6-luna", "custom:b1": "gpt-6.1-sol" };
    expect(custom.map((e) => chatModel(e, chosen))).toEqual([
      "gpt-6-luna",
      "gpt-6.1-sol",
    ]);
    // None saved: nothing to choose.
    expect(
      withCustomEndpoints(catalog, []).some((e) => e.auth.includes("custom")),
    ).toBe(false);
    expect(list.length).toBe(catalog.length + 1);
  });

  it("are told from the catalog's providers by id", () => {
    expect(isCustomId("custom")).toBe(true);
    expect(isCustomId("custom:b1")).toBe(true);
    expect(isCustomId("openai")).toBe(false);
    expect(isCustomId("customer")).toBe(false);
  });

  it("removed, leave no choice pointing at them", () => {
    const settings = {
      aiProvider: "custom:b1",
      writingProvider: "custom:b1",
      agentModels: { "custom:b1": "m", openai: "gpt-6-luna" },
      writingModels: { "custom:b1": "m" },
    };
    expect(settingsWithout(settings, "custom:b1")).toEqual({
      aiProvider: "openai",
      writingProvider: "",
      agentModels: { openai: "gpt-6-luna" },
      writingModels: {},
    });
    // Another endpoint's removal leaves the choices be.
    expect(settingsWithout(settings, "custom")).toEqual({
      agentModels: settings.agentModels,
      writingModels: settings.writingModels,
    });
  });
});
