import { describe, expect, it } from "vitest";
import type { DocTab } from "../../document/doc-tabs";
import { pane, panesOf, type LayoutNode } from "../../engine/layout/tree";
import { withDraftInFront, withTabInFront } from "./window-session";

const tabs = [
  { id: "a", path: "/n/Ideas.md" },
  { id: "d", path: null },
] as DocTab[];
const saved: LayoutNode = {
  kind: "split",
  direction: "row",
  children: [pane(["a"]), pane(["ai"])],
} as unknown as LayoutNode;

describe("a split brought back at launch", () => {
  it("keeps the draft that was in front in front of its first island", () => {
    const [first] = panesOf(withDraftInFront(saved, tabs, "d"));
    expect(first).toMatchObject({ tabs: ["a", "d"], front: "d" });
  });

  it("is left as saved when a file was in front", () => {
    expect(withDraftInFront(saved, tabs, "a")).toBe(saved);
  });

  it("puts a document opened from outside in front, in its island or the first", () => {
    const two = {
      ...saved,
      children: [pane(["a"]), pane(["b", "c"])],
    } as unknown as LayoutNode;
    const held = withTabInFront(two, "b");
    const [, second] = panesOf(held.root);
    expect(second).toMatchObject({ tabs: ["b", "c"], front: "b" });
    expect(held.island).toBe(second.id);
    const fresh = withTabInFront(two, "e");
    expect(panesOf(fresh.root)[0]).toMatchObject({
      tabs: ["a", "e"],
      front: "e",
    });
  });
});
