import { expect, it } from "vitest";
import { fitTabs } from "./SidebarTabBar";

const tabs = ["tree", "outline", "clipboard", "a", "b", "c"].map((id) => ({
  id,
}));
const ids = (list: { id: string }[]) => list.map((tab) => tab.id);

it("shows every tab that fits, the rest under More", () => {
  expect(ids(fitTabs(tabs, "tree", 6).inline)).toHaveLength(6);
  const { inline, more } = fitTabs(tabs, "tree", 4);
  expect(ids(inline)).toEqual(["tree", "outline", "clipboard"]);
  expect(ids(more)).toEqual(["a", "b", "c"]);
});

it("keeps a button for the tab shown, even one that would go under More", () => {
  const { inline, more } = fitTabs(tabs, "c", 4);
  expect(ids(inline)).toEqual(["tree", "outline", "c"]);
  expect(ids(more)).toEqual(["clipboard", "a", "b"]);
});
