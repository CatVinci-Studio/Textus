import { describe, expect, it } from "vitest";
import { pluginMenuEntries } from "./plugin-lookup";
import type { PluginsSnapshot } from "./plugin-records";

const plugin = (id: string, contributes: Record<string, unknown>) => ({
  id,
  status: "on",
  manifest: {
    name: id,
    contributes: {
      commands: [{ command: `${id}.go`, title: "Go" }],
      menus: {},
      settings: [],
      ...contributes,
    },
  },
});

const snapshot = (records: unknown[]) =>
  ({ allOn: true, records }) as unknown as PluginsSnapshot;

describe("a plugin's place in the Plugins menu", () => {
  it("ends with its settings, after its commands", () => {
    const entries = pluginMenuEntries(
      snapshot([
        plugin("a.one", {
          menus: { "app/plugins": [{ command: "a.one.go" }] },
          settings: [{ key: "x" }],
        }),
      ]),
      "app/plugins",
      "en",
    );
    expect(entries.map((e) => e.command)).toEqual([
      "a.one.go",
      "plugin-settings:a.one",
    ]);
    expect(entries[1].label).toBe("Settings…");
  });

  it("is its settings alone, named for it, with no commands there", () => {
    const entries = pluginMenuEntries(
      snapshot([
        plugin("a.two", { settingsPage: "s.html" }),
        plugin("a.three", {}),
      ]),
      "app/plugins",
      "en",
    );
    expect(entries).toEqual([
      {
        command: "plugin-settings:a.two",
        label: "a.two Settings…",
        group: "a.two",
      },
    ]);
    // Not in the tray's menu.
    expect(
      pluginMenuEntries(
        snapshot([plugin("a.two", { settingsPage: "s.html" })]),
        "app/tray",
        "en",
      ),
    ).toEqual([]);
  });
});
