import { expect, it } from "vitest";
import type { Creation } from "../../prefs/settings-types";
import type { PluginRecord } from "../../plugins/store/plugin-records";
import { storedCreations } from "../../prefs/settings-normalise";
import { creationRows, withCreation, withoutCreation } from "./creations";

const made = (kind: Creation["kind"], id: string, at: number): Creation => ({
  kind,
  id,
  name: id,
  at,
});

const plugin = (id: string, status: PluginRecord["status"]): PluginRecord => ({
  id,
  origin: "installed",
  manifest: null,
  status,
  granted: [],
  official: false,
});

it("puts a reinstalled thing first, once", () => {
  const list = [made("plugin", "a", 1), made("theme", "a", 2)];
  expect(withCreation(list, made("plugin", "a", 3))).toEqual([
    made("plugin", "a", 3),
    made("theme", "a", 2),
  ]);
  expect(withoutCreation(list, "theme", "a")).toEqual([made("plugin", "a", 1)]);
});

it("lists what is still installed, newest first, with where each stands", () => {
  const list = [
    made("plugin", "p.on", 1),
    made("theme", "user-1", 4),
    made("skill", "tidy", 3),
    made("plugin", "p.gone", 5),
    made("theme", "user-gone", 6),
  ];
  const rows = creationRows(list, {
    plugins: [plugin("p.on", "on")],
    userThemes: [{ id: "user-1", name: "Night", hasDark: false }],
    themeId: "user-1",
    skills: [{ name: "tidy", source: "global", modes: ["write"], off: true }],
  });
  expect(rows.map((r) => [r.creation.id, r.state])).toEqual([
    ["user-1", { kind: "theme", inUse: true }],
    ["tidy", { kind: "skill", modes: ["write"], off: true }],
    ["p.on", { kind: "plugin", on: true, problem: false }],
  ]);
});

it("keeps skills while they load, and drops a built-in of the same name", () => {
  const list = [made("skill", "tidy", 1)];
  const now = { plugins: [], userThemes: [], themeId: "default" };
  expect(creationRows(list, { ...now, skills: null })[0].state).toEqual({
    kind: "unknown",
  });
  expect(
    creationRows(list, {
      ...now,
      skills: [{ name: "tidy", source: "builtin" }],
    }),
  ).toEqual([]);
});

it("reads back only well-formed stored entries", () => {
  expect(
    storedCreations([
      made("skill", "tidy", 1),
      { kind: "macro", id: "x", name: "x", at: 1 },
      { kind: "theme", id: "", name: "x", at: 1 },
      "plugin",
    ]),
  ).toEqual([made("skill", "tidy", 1)]);
  expect(storedCreations(undefined)).toEqual([]);
});
