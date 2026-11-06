import { beforeAll, expect, it } from "vitest";
import { pinyinEngine } from "../../utils/pinyin";
import { preparePinyin, prepareList, rankList } from "../../utils/list-filter";
import type { PanelItem } from "./sources";

// The panel's budget: each keystroke filters and ranks 10,000 notes well
// inside a frame, so typing never waits on the list.

beforeAll(() => pinyinEngine.load());

const WORDS = ["project", "meeting", "draft", "Research", "Café", "idea"];
const HAN = ["会议记录", "读书笔记", "项目计划", "周报", "灵感", "论文草稿"];

const ready = (items: PanelItem[]) => {
  const list = prepareList(items);
  preparePinyin(list, Infinity);
  return list;
};

function notes(count: number): PanelItem[] {
  return Array.from({ length: count }, (_, i) => {
    const kind = i % 3;
    const label =
      kind === 0
        ? `${WORDS[i % WORDS.length]} ${i}`
        : kind === 1
          ? `${HAN[i % HAN.length]}${i}`
          : `areas/${WORDS[(i * 7) % WORDS.length]}/notes ${i}`;
    return { label, insert: `[[${label}]]`, keywords: `alias${i}` };
  });
}

/** What a user types: a word growing a letter at a time, in English,
 *  pinyin and Chinese, with backspaces. */
function keystrokes(): string[] {
  const typed = ["meeting 12", "huiyi", "会议记录", "areas/res", "zz"];
  const out: string[] = [];
  while (out.length < 200)
    for (const word of typed)
      for (let n = 1; n <= word.length && out.length < 200; n++)
        out.push(word.slice(0, n));
  return out;
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

it("filters 10,000 notes per keystroke within budget (median ≤ 8 ms, p95 ≤ 16 ms)", () => {
  const items = notes(10_000);
  const prepared = performance.now();
  const list = prepareList(items);
  const prepareMs = performance.now() - prepared;
  preparePinyin(list, Infinity);
  // Warm the engine's code paths, as a session's first keys do.
  for (const query of ["m", "hu", "会"]) rankList(list, query, 50);
  const times: number[] = [];
  for (const query of keystrokes()) {
    const start = performance.now();
    rankList(list, query, 50);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = percentile(times, 0.5);
  const p95 = percentile(times, 0.95);
  console.info(
    `panel filter, 10,000 items: median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms; labels folded once in ${prepareMs.toFixed(1)} ms`,
  );
  expect(median).toBeLessThanOrEqual(8);
  expect(p95).toBeLessThanOrEqual(16);
});

it("ranks a label starting with the query first (the closest first), then a word starting with it, then pinyin", () => {
  const list = ready(
    ["Old meeting", "rem", "Meeting notes", "会议", "mee"].map((label) => ({
      label,
      insert: label,
    })),
  );
  expect(rankList(list, "mee", 10).map((i) => i.label)).toEqual([
    "mee",
    "Meeting notes",
    "Old meeting",
  ]);
  expect(rankList(list, "hy", 10).map((i) => i.label)).toEqual(["会议"]);
  expect(rankList(list, "", 2).map((i) => i.label)).toEqual([
    "Old meeting",
    "rem",
  ]);
});

it("finds an item by its keywords", () => {
  const list = ready([
    { label: "表格", insert: "", keywords: "Table" },
    { label: "引用", insert: "", keywords: "Quote" },
  ]);
  expect(rankList(list, "table", 10).map((i) => i.label)).toEqual(["表格"]);
});
