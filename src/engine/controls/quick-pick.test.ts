// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Request } from "./quick-pick-queue";
import { quickPickFilter, useShownItems } from "./quick-pick-shown";

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

describe("a quick pick that searches", () => {
  it("shows its items, then what it answers once typing rests", async () => {
    vi.useFakeTimers();
    const search = vi.fn(async (query: string) => [{ label: `${query}!` }]);
    const request = {
      id: 1,
      items: [{ label: "start" }],
      placeholder: "",
      multiple: false,
      query: "",
      typed: false,
      search,
      resolve: () => {},
    } satisfies Request;
    const { result, rerender } = renderHook(
      ({ query }) => useShownItems(request, query),
      { initialProps: { query: "ab" } },
    );
    expect(result.current).toEqual([{ label: "start" }]);
    rerender({ query: "abc" });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    vi.useRealTimers();
    // Asked once, for what rested.
    expect(search).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual([{ label: "abc!" }]);
  });
});
