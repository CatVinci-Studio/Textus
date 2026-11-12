// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PluginStatusItems } from "./PluginStatusItems";
import { runCommand } from "../registry/commands";
import {
  removeStatusItem,
  setStatusItem,
} from "../plugins/contributions/status-items";

vi.mock("../registry/commands", () => ({ runCommand: vi.fn() }));
vi.mock("../plugins/store/plugin-records", () => {
  const snapshot = {
    loaded: true,
    allOn: true,
    records: [{ id: "a.timer", manifest: null }],
  };
  return {
    pluginsSnapshot: () => snapshot,
    subscribePlugins: () => () => {},
    pluginName: () => "Timer",
  };
});
vi.mock("../plugins/store/plugin-lookup", () => ({
  pluginMenuEntries: () => [{ command: "a.timer.reset", label: "Reset" }],
}));

afterEach(() => {
  cleanup();
  removeStatusItem("a.timer");
  removeStatusItem("b.goal");
});

it("shows a plugin with one thing and no commands as that thing", () => {
  setStatusItem("b.goal", "goal", { text: "300/500", command: "b.goal.open" });
  render(<PluginStatusItems />);
  fireEvent.click(screen.getByText("300/500"));
  expect(runCommand).toHaveBeenCalledWith("b.goal.open");
  expect(screen.queryByRole("menu")).toBeNull();
});

it("gathers a plugin's items and commands behind one entry, under its name", () => {
  setStatusItem("a.timer", "time", { text: "25:00", command: "a.timer.start" });
  setStatusItem("a.timer", "laps", { text: "3 laps" });
  render(<PluginStatusItems />);
  // One entry for the plugin: its first item.
  expect(screen.queryByText("3 laps")).toBeNull();
  fireEvent.click(screen.getByText("25:00"));
  const menu = screen.getByRole("menu", { name: "Timer" });
  expect(
    [...menu.querySelectorAll("[role=menuitem]")].map((m) => m.textContent),
  ).toEqual(["25:00", "3 laps", "Reset"]);
  fireEvent.click(screen.getByRole("menuitem", { name: "Reset" }));
  expect(runCommand).toHaveBeenCalledWith("a.timer.reset");
  expect(screen.queryByRole("menu")).toBeNull();
});
