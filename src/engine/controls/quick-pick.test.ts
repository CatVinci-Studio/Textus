import { beforeAll, describe, expect, it } from "vitest";
import { quickPickFilter } from "./quick-pick";

const quickPickMatches = (
  item: { label: string; description?: string },
  query: string,
) => quickPickFilter([item], query).length > 0;
import { pinyinEngine } from "../../utils/pinyin";

beforeAll(() => pinyinEngine.load());

describe("the quick pick's filter", () => {
  it("matches every word typed, or a Chinese label spelled in pinyin", () => {
    const item = { label: "导出 PDF", description: "文件" };
    expect(quickPickMatches(item, "pdf 导出")).toBe(true);
    expect(quickPickMatches(item, "daochu")).toBe(true);
    expect(quickPickMatches(item, "dc")).toBe(true);
    expect(quickPickMatches(item, "dk")).toBe(false);
    expect(
      quickPickMatches({ label: "Thème de l’éditeur…" }, "theme edi"),
    ).toBe(true);
  });

  it("puts a label starting with the query first", () => {
    const items = [{ label: "Export PDF" }, { label: "PDF Viewer" }];
    expect(quickPickFilter(items, "pdf").map((i) => i.label)).toEqual([
      "PDF Viewer",
      "Export PDF",
    ]);
  });
});
