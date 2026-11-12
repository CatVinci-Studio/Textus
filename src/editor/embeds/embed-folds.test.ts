// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installTestLocalStorage } from "../../dev/test-local-storage";
import { resetUiStateForTests, setUiState } from "../../storage/ui-state";
import { embedFolded, setEmbedFolded } from "./embed-folds";

describe("folded embeds", () => {
  beforeAll(installTestLocalStorage);
  beforeEach(() => {
    localStorage.clear();
    resetUiStateForTests();
  });

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
    setUiState("foldedEmbeds", "nonsense" as unknown as string[]);
    expect(embedFolded("nonsense")).toBe(false);
    setUiState("foldedEmbeds", ["a", 3] as unknown as string[]);
    expect(embedFolded("a")).toBe(true);
  });
});
