import { describe, expect, it } from "vitest";
import { groupStatusItems } from "./status-groups";
import { withDeclared, type StatusItem } from "./status-items";
import { parseManifest } from "../store/manifest";

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

describe("withDeclared", () => {
  const record = (status: "on" | "off") => ({
    id: "a.one",
    origin: "user" as never,
    status: status as never,
    granted: [],
    official: false,
    manifest: parseManifest({
      id: "a.one",
      name: "One",
      version: "1.0.0",
      publisher: "a",
      engines: { textus: "^1.3.0" },
      l10n: { en: { idle: "Idle" } },
      contributes: { statusItems: [{ id: "s", text: "%idle%" }] },
    }),
  });
  const of = (status: "on" | "off") => ({
    loaded: true,
    allOn: true,
    records: [record(status)],
  });

  it("shows a plugin's declared status while it is on, until its code sets its own", () => {
    expect(withDeclared([], of("on"), "en")).toEqual([
      { key: "a.one/s", plugin: "a.one", text: "Idle" },
    ]);
    expect(withDeclared([], of("off"), "en")).toEqual([]);
    const own = { ...item("a.one", "s"), text: "Busy" };
    expect(withDeclared([own], of("on"), "en")).toEqual([own]);
  });
});
