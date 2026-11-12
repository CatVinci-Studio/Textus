import { describe, expect, it } from "vitest";
import snapshot from "./models-snapshot.json";
import { PROVIDER_CATALOG } from "../platform/bindings/ai";
import type { ProviderCatalogEntry } from "./provider-catalog";

type Snapshot = {
  unmapped: string[];
  providers: Record<string, { models: Record<string, { status?: string }> }>;
};

// The backend's catalog, as generated, checked against the models.dev
// snapshot so it never pins a model that no longer exists.
describe("the provider catalog", () => {
  const data = snapshot as Snapshot;
  for (const entry of PROVIDER_CATALOG as readonly ProviderCatalogEntry[]) {
    if (data.unmapped.includes(entry.id)) continue;
    it(`pins only current ${entry.id} models`, () => {
      const models = data.providers[entry.id]?.models;
      expect(models, `${entry.id} isn't in the snapshot`).toBeDefined();
      const pinned = [
        entry.defaultModel,
        entry.agentDefaultModel,
        ...entry.knownModels,
      ].filter((m): m is string => !!m);
      for (const id of pinned) {
        expect(models![id], `${entry.id}/${id} is not listed`).toBeDefined();
        expect(models![id].status).not.toBe("deprecated");
      }
    });
  }
});
