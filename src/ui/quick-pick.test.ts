import { beforeAll, describe, expect, it } from "vitest";
import { quickPickMatches } from "./quick-pick";
import { pinyinEngine } from "../utils/pinyin";

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
});
