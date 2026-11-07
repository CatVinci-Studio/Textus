import { beforeEach, describe, expect, it, vi } from "vitest";

const kept = new Map<string, unknown>();
vi.mock("../../storage/ui-state", () => ({
  getUiState: (key: string) => kept.get(key),
  setUiState: (key: string, value: unknown) => kept.set(key, value),
}));

const { embedFolded, setEmbedFolded } = await import("./embed-folds");

describe("folded embeds", () => {
  beforeEach(() => kept.clear());

  it("are remembered until unfolded", () => {
    setEmbedFolded("a.md\nb.md#", true);
    expect(embedFolded("a.md\nb.md#")).toBe(true);
    expect(embedFolded("a.md\nc.md#")).toBe(false);
    setEmbedFolded("a.md\nb.md#", false);
    expect(embedFolded("a.md\nb.md#")).toBe(false);
  });

  it("keep the 300 latest, the oldest going first", () => {
    for (let i = 0; i < 301; i++) setEmbedFolded(`k${i}`, true);
    expect(embedFolded("k0")).toBe(false);
    expect(embedFolded("k1")).toBe(true);
    expect(embedFolded("k300")).toBe(true);
  });

  it("ignore what isn't a list of keys", () => {
    kept.set("foldedEmbeds", "nonsense");
    expect(embedFolded("nonsense")).toBe(false);
    kept.set("foldedEmbeds", ["a", 3]);
    expect(embedFolded("a")).toBe(true);
  });
});
