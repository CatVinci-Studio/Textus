// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const suggestTitle = vi.hoisted(() => vi.fn());
vi.mock("../ai/workspace/assist", () => ({ suggestTitle }));
import { useAutoTitle } from "./useAutoTitle";
import { hasSuggestedTitle } from "../document/doc-tabs";
import type { Settings } from "../settings/SettingsContext";

const settings = { autoTitleDocuments: true, language: "zh" } as Settings;
const long =
  "马孔多的百年里，布恩迪亚家族一代又一代重复着同样的名字和同样的孤独。".repeat(
    2,
  );

beforeEach(() => {
  vi.useFakeTimers();
  suggestTitle.mockReset();
});
afterEach(() => vi.useRealTimers());

it("names an untitled document once its text settles, whatever brought it", async () => {
  suggestTitle.mockResolvedValue("百年孤独阅读概要");
  const { result } = renderHook(() =>
    useAutoTitle("tab-a", null, settings, ""),
  );
  act(() => result.current("太短"));
  act(() => result.current(long));
  expect(suggestTitle).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2600);
  });
  expect(suggestTitle).toHaveBeenCalledTimes(1);
  expect(hasSuggestedTitle("tab-a")).toBe(true);
  // Named once.
  act(() => result.current(`${long}更多`));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2600);
  });
  expect(suggestTitle).toHaveBeenCalledTimes(1);
});

it("counts the text a document opens with, and retries after a failure", async () => {
  suggestTitle.mockRejectedValueOnce(new Error("offline"));
  suggestTitle.mockResolvedValueOnce("第二次");
  const { result } = renderHook(() =>
    useAutoTitle("tab-b", null, settings, long),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2600);
  });
  expect(suggestTitle).toHaveBeenCalledTimes(1);
  expect(hasSuggestedTitle("tab-b")).toBe(false);
  act(() => result.current(`${long}。`));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2600);
  });
  expect(hasSuggestedTitle("tab-b")).toBe(true);
});

it("leaves saved files and documents with a heading alone", async () => {
  const saved = renderHook(() =>
    useAutoTitle("tab-c", "/docs/a.md", settings, long),
  );
  const headed = renderHook(() => useAutoTitle("tab-d", null, settings, ""));
  act(() => headed.result.current(`# 标题\n\n${long}`));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2600);
  });
  expect(suggestTitle).not.toHaveBeenCalled();
  saved.unmount();
});
