import { afterEach, beforeAll, expect, it } from "vitest";
import { addSlashItems, slashPanelItems } from "./slash-commands";
import { pinyinEngine } from "../../utils/pinyin";
import {
  preparePinyin,
  prepareList,
  rankList,
} from "../../utils/list-filter";
import { matchSources } from "../../editor/completion/panel-rows";
import { completionSources } from "../../editor/completion/sources";

beforeAll(() => pinyinEngine.load());

let remove: (() => void) | null = null;
afterEach(() => remove?.());

const item = (label: string, keywords?: string) => ({
  label,
  detail: "Quick Insert",
  keywords,
  shown: () => true,
  run() {},
});

/** What the panel's / group lists for `text` before the caret. */
function labels(text: string): string[] {
  const match = matchSources(completionSources(), text, false).find(
    (m) => m.source.id === "textus.slash",
  );
  if (!match) return [];
  const list = prepareList(slashPanelItems());
  preparePinyin(list, Infinity);
  return rankList(list, match.query, 50).map((i) => i.label);
}

it("finds an item by its name, its English name, or a Chinese name in pinyin", () => {
  remove = addSlashItems("test.quick", [
    item("表格", "Table"),
    item("引用", "Quote"),
  ]);
  expect(labels("/表")).toEqual(["表格"]);
  expect(labels("/table")).toEqual(["表格"]);
  expect(labels("/biaoge")).toEqual(["表格"]);
  expect(labels("/yy")).toEqual(["引用"]);
  // Only at a word's start: not a path, a date or a fraction.
  expect(labels("a/table")).toEqual([]);
  expect(labels("/zzz")).toEqual([]);
});

it("replaces only the / word, not the space before it", () => {
  const match = matchSources(completionSources(), "see /tab", false).find(
    (m) => m.source.id === "textus.slash",
  );
  expect(match?.match).toBe("/tab");
  expect(match?.query).toBe("tab");
});
