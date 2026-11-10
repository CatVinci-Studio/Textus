import { describe, expect, it } from "vitest";
import { islandKeys } from "./island-keys";

describe("islandKeys", () => {
  it("the island split keeps its key; the new one gets its own", () => {
    const one = islandKeys([{ id: "window", tabs: ["a", "b"] }], new Map());
    expect(one.keys).toEqual(["island:window"]);
    const two = islandKeys(
      [
        { id: "p1", tabs: ["a", "b"] },
        { id: "p2", tabs: ["ai"] },
      ],
      one.byTab,
    );
    expect(two.keys).toEqual(["island:window", "island:p2"]);
  });

  it("a tab pulled out leaves the key with the island most tabs stay in", () => {
    const before = new Map([
      ["a", "k"],
      ["b", "k"],
      ["c", "k"],
    ]);
    const { keys } = islandKeys(
      [
        { id: "p1", tabs: ["c"] },
        { id: "p2", tabs: ["a", "b"] },
      ],
      before,
    );
    expect(keys).toEqual(["island:p1", "k"]);
  });

  it("merged back to one, the island takes the larger one's key", () => {
    const before = new Map([
      ["a", "k1"],
      ["b", "k1"],
      ["ai", "k2"],
    ]);
    const { keys } = islandKeys(
      [{ id: "window", tabs: ["a", "b", "ai"] }],
      before,
    );
    expect(keys).toEqual(["k1"]);
  });
});
