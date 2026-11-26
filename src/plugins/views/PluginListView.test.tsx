// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { configurePlugins } from "../store/plugin-records";
import type { Strings } from "../../i18n/strings";
import { askPlugin } from "../manager";
import { PluginListPane, type PluginListItem } from "./PluginListView";

const items: PluginListItem[] = [
  {
    label: "planning",
    actions: [{ label: "Rename", command: "tags.rename" }],
  },
  { label: "project" },
];

vi.mock("./usePluginListItems", () => ({
  keyOf: (item: PluginListItem, i: number) => item.id ?? String(i),
  usePluginListItems: () => ({
    info: { select: true },
    items,
    swapItem: () => {},
    children: new Map(),
    open: new Set(),
    toggleOpen: () => {},
    error: null,
    fail: () => {},
  }),
}));
vi.mock("../manager", () => ({ askPlugin: vi.fn(async () => null) }));

beforeEach(() => {
  vi.useFakeTimers();
  configurePlugins({
    strings: () => ({}) as Strings,
    language: () => "en",
    dark: () => false,
  });
});
afterEach(() => vi.useRealTimers());

it("opens a row's menu for a finger held on it, as a right-click does", () => {
  render(<PluginListPane plugin="catvinci.tags" view="tags" />);
  const [row, plain] = screen.getAllByRole("treeitem");
  fireEvent.touchStart(row, { touches: [{ clientX: 30, clientY: 40 }] });
  act(() => vi.advanceTimersByTime(600));
  fireEvent.touchEnd(row);
  expect(screen.getByRole("menuitem", { name: "Rename" })).toBeTruthy();

  // The tap after it opens what it is on.
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(plain);
  expect(askPlugin).toHaveBeenCalledWith("catvinci.tags", "$listSelect", {
    view: "tags",
    item: items[1],
  });

  // A row with nothing to do has no menu to hold for.
  fireEvent.touchStart(plain, { touches: [{ clientX: 30, clientY: 80 }] });
  act(() => vi.advanceTimersByTime(600));
  expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
});
