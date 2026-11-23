import type { Strings, TextKey } from "../../i18n/strings";
import type { PluginManifest } from "./manifest-types";

/** The store's categories, in the order it lists them; a plugin names one
 *  as its manifest's `category`. The schema's enum is this list. */
export const PLUGIN_CATEGORIES = [
  "notes",
  "editing",
  "diagrams",
  "files",
  "import",
  "sync",
  "ai",
  "companions",
] as const;

export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

/** Where a plugin with no category, or one this Textus doesn't know, goes. */
export type CategoryGroup = PluginCategory | "other";

const LABELS: Record<CategoryGroup, TextKey> = {
  notes: "pluginCategoryNotes",
  editing: "pluginCategoryEditing",
  diagrams: "pluginCategoryDiagrams",
  files: "pluginCategoryFiles",
  import: "pluginCategoryImport",
  sync: "pluginCategorySync",
  ai: "pluginCategoryAi",
  companions: "pluginCategoryCompanions",
  other: "pluginCategoryOther",
};

export function categoryLabel(group: CategoryGroup, t: Strings): string {
  return t[LABELS[group]];
}

/** The manifest's `category` when it is one of ours; a newer one reads as
 *  none, so an older Textus still lists the plugin. */
export function readCategory(value: string): PluginCategory | undefined {
  return (PLUGIN_CATEGORIES as readonly string[]).includes(value)
    ? (value as PluginCategory)
    : undefined;
}

/** `items` by category, in the store's order with Other last, each keeping
 *  the order it had; a category with none is left out. */
export function groupByCategory<
  T extends { manifest: Pick<PluginManifest, "category"> },
>(items: readonly T[]): { group: CategoryGroup; items: T[] }[] {
  const order: CategoryGroup[] = [...PLUGIN_CATEGORIES, "other"];
  return order
    .map((group) => ({
      group,
      items: items.filter((i) => (i.manifest.category ?? "other") === group),
    }))
    .filter((g) => g.items.length > 0);
}

/** `items` in category order, and the heading that goes before each
 *  category's first (none when they are all in one): the store lists them
 *  so, still a plugin a row. */
export function byCategory<
  T extends { id: string; manifest: Pick<PluginManifest, "category"> },
>(
  items: readonly T[],
  t: Strings,
): { items: T[]; headings: Map<string, string> } {
  const groups = groupByCategory(items);
  return {
    items: groups.flatMap((g) => g.items),
    headings: new Map(
      groups.length > 1
        ? groups.map((g) => [g.items[0].id, categoryLabel(g.group, t)])
        : [],
    ),
  };
}
