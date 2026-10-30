import { afterEach, expect, it } from "vitest";
import { addSlashItems, slashItemsFor } from "./slash-commands";

let remove: (() => void) | null = null;
afterEach(() => remove?.());

const item = (label: string, keywords?: string) => ({
  label,
  detail: "Quick Insert",
  keywords,
  shown: () => true,
  run() {},
});

it("finds an item by its name, its English name, or a Chinese name in pinyin", () => {
  remove = addSlashItems("test.quick", [
    item("表格", "Table"),
    item("引用", "Quote"),
  ]);
  const labels = (text: string) =>
    slashItemsFor(text)?.items.map((i) => i.label) ?? [];
  expect(labels("/表")).toEqual(["表格"]);
  expect(labels("/table")).toEqual(["表格"]);
  expect(labels("/biaoge")).toEqual(["表格"]);
  expect(labels("/yy")).toEqual(["引用"]);
  // Only at a word's start: not a path, a date or a fraction.
  expect(labels("a/table")).toEqual([]);
  expect(slashItemsFor("/zzz")).toBeNull();
});
