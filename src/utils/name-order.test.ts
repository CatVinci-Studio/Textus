import { describe, expect, it } from "vitest";
import { compareEntries, nameCollator, compareNames } from "./name-order";

const sorted = (locale: string, names: string[], dirs: string[] = []) =>
  [
    ...names.map((name) => ({ name, is_dir: false })),
    ...dirs.map((name) => ({ name, is_dir: true })),
  ]
    .sort((a, b) => compareEntries(nameCollator(locale), a, b))
    .map((entry) => entry.name);

describe("the order of file names", () => {
  it("puts folders first", () => {
    expect(sorted("en", ["a.md", "z.md"], ["notes"])).toEqual([
      "notes",
      "a.md",
      "z.md",
    ]);
  });

  it("orders numbers by value", () => {
    expect(
      sorted("en", ["file10.md", "file2.md", "file1.md", "File3.md"]),
    ).toEqual(["file1.md", "file2.md", "File3.md", "file10.md"]);
    expect(sorted("zh-CN", ["第10章.md", "第2章.md", "第1章.md"])).toEqual([
      "第1章.md",
      "第2章.md",
      "第10章.md",
    ]);
  });

  it("ignores case and accents but keeps a fixed order for ties", () => {
    expect(sorted("en", ["cafe.md", "b.md", "Café.md", "A.md"])).toEqual([
      "A.md",
      "b.md",
      "Café.md",
      "cafe.md",
    ]);
  });

  it("sorts Simplified Chinese by pinyin", () => {
    // 北京 bei, 上海 shang, 广州 guang
    expect(sorted("zh-CN", ["上海.md", "北京.md", "广州.md"])).toEqual([
      "北京.md",
      "广州.md",
      "上海.md",
    ]);
  });
});

it("puts names in reading order, numbers by value", () => {
  const names = ["Week 10", "Week 2", "week 1", "Week 11"];
  expect([...names].sort(compareNames)).toEqual([
    "week 1",
    "Week 2",
    "Week 10",
    "Week 11",
  ]);
});
