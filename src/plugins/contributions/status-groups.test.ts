import { describe, expect, it } from "vitest";
import { groupStatusItems } from "./status-groups";
import type { StatusItem } from "./status-items";

const item = (plugin: string, id: string): StatusItem => ({
  key: `${plugin}/${id}`,
  plugin,
  text: id,
});

describe("groupStatusItems", () => {
  it("puts each plugin's items together, where its first one came", () => {
    const groups = groupStatusItems(
      [
        item("a.timer", "time"),
        item("b.goal", "goal"),
        item("a.timer", "laps"),
      ],
      [],
    );
    expect(groups.map((g) => [g.plugin, g.items.map((i) => i.text)])).toEqual([
      ["a.timer", ["time", "laps"]],
      ["b.goal", ["goal"]],
    ]);
  });

  it("gives each plugin its own commands, not another's that shares a prefix", () => {
    const [group] = groupStatusItems(
      [item("a.timer", "time")],
      [
        { command: "a.timer.start", label: "Start" },
        { command: "a.timers.reset", label: "Reset" },
      ],
    );
    expect(group.commands).toEqual([
      { command: "a.timer.start", label: "Start" },
    ]);
  });
});
