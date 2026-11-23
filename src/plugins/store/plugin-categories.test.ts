import { describe, expect, it } from "vitest";
import en from "../../i18n/locales/en";
import type { Strings } from "../../i18n/strings";
import { parseManifest } from "./manifest";
import {
  PLUGIN_CATEGORIES,
  byCategory,
  categoryLabel,
} from "./plugin-categories";

const manifest = (id: string, extra: object = {}) =>
  parseManifest({
    id,
    name: id,
    version: "1.0.0",
    publisher: "a",
    engines: { textus: "^1.3.0" },
    ...extra,
  });

describe("a plugin's category and whether it needs Textus AI", () => {
  it("are read from its manifest", () => {
    const m = manifest("a.b", { category: "diagrams", needsTextusAi: true });
    expect(m.category).toBe("diagrams");
    expect(m.needsTextusAi).toBe(true);
    const plain = manifest("a.c");
    expect(plain.category).toBeUndefined();
    expect(plain.needsTextusAi).toBe(false);
  });

  it("take a category this Textus doesn't know as none", () => {
    expect(manifest("a.b", { category: "games" }).category).toBeUndefined();
  });
});

describe("the store's categories", () => {
  it("group plugins in the store's order, Other last, empty ones left out", () => {
    const items = [
      manifest("a.pet", { category: "companions" }),
      manifest("a.x"),
      manifest("a.chart", { category: "diagrams" }),
      manifest("a.tags", { category: "notes" }),
      manifest("a.plot", { category: "diagrams" }),
      manifest("a.new", { category: "games" }),
    ].map((m) => ({ id: m.id, manifest: m }));
    expect(
      byCategory(items, en as Strings).map((r) => [r.item.id, r.heading]),
    ).toEqual([
      ["a.tags", en.pluginCategoryNotes],
      ["a.chart", en.pluginCategoryDiagrams],
      ["a.plot", undefined],
      ["a.pet", en.pluginCategoryCompanions],
      ["a.x", en.pluginCategoryOther],
      ["a.new", undefined],
    ]);
  });

  it("head each category's first plugin, and none when all are in one", () => {
    const item = (id: string, category?: string) => ({
      id,
      manifest: manifest(id, { category }),
    });
    const t = en as Strings;
    const listed = byCategory(
      [item("a.x"), item("a.tags", "notes"), item("a.plot", "diagrams")],
      t,
    );
    expect(listed.map((r) => [r.item.id, r.heading])).toEqual([
      ["a.tags", en.pluginCategoryNotes],
      ["a.plot", en.pluginCategoryDiagrams],
      ["a.x", en.pluginCategoryOther],
    ]);
    // A catalog from before categories: all Other, no heading.
    expect(
      byCategory([item("a.x"), item("a.y")], t).filter((r) => r.heading),
    ).toEqual([]);
  });

  it("each have a name", () => {
    for (const group of [...PLUGIN_CATEGORIES, "other" as const])
      expect(categoryLabel(group, en as Strings)).toMatch(/\S/);
  });
});
