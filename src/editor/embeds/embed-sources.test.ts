import { describe, expect, it, vi } from "vitest";
import {
  addEmbedProvider,
  embedProvider,
  onEmbedsChange,
  type EmbedProvider,
} from "./embed-sources";

const provider = (owner: string, kinds: EmbedProvider["kinds"]) => ({
  owner,
  id: `${owner}.embed`,
  kinds,
  provide: async () => null,
});

describe("embed providers", () => {
  it("give each kind one owner, the first, and hand it over when it goes", () => {
    const changed = vi.fn();
    const stop = onEmbedsChange(changed);
    const removeA = addEmbedProvider(provider("a", ["note", "heading"]));
    const removeB = addEmbedProvider(provider("b", ["note", "block"]));
    expect(embedProvider("note")?.owner).toBe("a");
    expect(embedProvider("block")?.owner).toBe("b");
    removeA();
    expect(embedProvider("note")?.owner).toBe("b");
    expect(embedProvider("heading")).toBeNull();
    // Each change redraws the embeds shown.
    expect(changed).toHaveBeenCalledTimes(3);
    removeB();
    stop();
    expect(embedProvider("note")).toBeNull();
  });
});
