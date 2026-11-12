import { describe, expect, it } from "vitest";
import menu from "./menu.json";
import en from "../../i18n/locales/en";

/** Every item of the menu, however deep. */
function items(node: unknown): { label?: string; en?: string }[] {
  if (Array.isArray(node)) return node.flatMap(items);
  if (!node || typeof node !== "object") return [];
  const own = node as { label?: string; en?: string };
  return [own, ...Object.values(node).flatMap(items)];
}

describe("menu.json", () => {
  it("keeps each English fallback the same as the interface's text", () => {
    const strings = en as unknown as Record<string, string>;
    const drift = items(menu)
      .filter((i) => i.label && i.en && strings[i.label] !== undefined)
      .filter((i) => strings[i.label!] !== i.en)
      .map((i) => `${i.label}: "${i.en}" vs "${strings[i.label!]}"`);
    expect(drift).toEqual([]);
  });
});
