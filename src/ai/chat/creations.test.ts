import { expect, it } from "vitest";
import type { Creation } from "../../prefs/settings-values";
import { storedCreations } from "../../prefs/settings-normalise";
import { madeByAi, withCreation, withoutCreation } from "./creations";

const made = (kind: Creation["kind"], id: string, at: number): Creation => ({
  kind,
  id,
  name: id,
  at,
});

it("says what Create made, by kind", () => {
  const list = [made("plugin", "local.toggle", 1)];
  expect(madeByAi(list, "plugin", "local.toggle")).toBe(true);
  expect(madeByAi(list, "theme", "local.toggle")).toBe(false);
});

it("puts a reinstalled thing first, once", () => {
  const list = [made("plugin", "a", 1), made("theme", "a", 2)];
  expect(withCreation(list, made("plugin", "a", 3))).toEqual([
    made("plugin", "a", 3),
    made("theme", "a", 2),
  ]);
  expect(withoutCreation(list, "theme", "a")).toEqual([made("plugin", "a", 1)]);
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
