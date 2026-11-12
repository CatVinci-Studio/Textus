import { describe, expect, it } from "vitest";
import { documentBesidePanels } from "./panel-add";
import { oneIsland, splitOff, type SplitLayout } from "../../engine/layout/ops";
import { panesOf, type Pane } from "../../engine/layout/tree";

const pages = new Set(["ai1", "ai2", "settings"]);
const isPanel = (p: Pane) =>
  p.tabs.length > 0 && p.tabs.every((id) => pages.has(id));
const tabsOf = (layout: SplitLayout | null) =>
  panesOf(layout!.root).map((p) => p.tabs);

describe("documentBesidePanels", () => {
  it("opens a document in an island of its own left of the AI's", () => {
    const ai = oneIsland(["ai1"], "ai1");
    expect(tabsOf(documentBesidePanels("doc", isPanel)(ai))).toEqual([
      ["doc"],
      ["ai1"],
    ]);
  });

  it("joins the island with documents when there is one", () => {
    const both = splitOff(
      oneIsland(["a.md", "ai1"], "a.md"),
      "ai1",
      null,
      "right",
    );
    expect(tabsOf(documentBesidePanels("doc", isPanel)(both!))).toEqual([
      ["a.md", "doc"],
      ["ai1"],
    ]);
  });
});
