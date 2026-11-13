// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { keepLoaded } from "./kept-loaded";
import { memoryLimits } from "./memory-policy";

const KEEP_HIDDEN_MS = memoryLimits().hiddenMs;

afterEach(() => vi.useRealTimers());

it("lets a view out of sight go after a while, and keeps three at most", () => {
  vi.useFakeTimers();
  const gone: number[] = [];
  const views = [0, 1, 2, 3].map((i) => keepLoaded("test", () => gone.push(i)));
  views[0].shown();
  views[0].hidden();
  vi.advanceTimersByTime(KEEP_HIDDEN_MS - 1);
  expect(gone).toEqual([]);
  // Shown again in time: kept.
  views[0].shown();
  vi.advanceTimersByTime(KEEP_HIDDEN_MS);
  expect(gone).toEqual([]);
  views[0].hidden();
  views[1].shown();
  views[1].hidden();
  views[2].shown();
  // A fourth shown: the longest unseen hidden one goes first.
  views[3].shown();
  expect(gone).toEqual([0]);
  vi.advanceTimersByTime(KEEP_HIDDEN_MS);
  expect(gone).toEqual([0, 1]);
});

it("lets go of what no longer fits when memory gets short", async () => {
  const { setMemoryState } = await import("./memory-policy");
  const gone: number[] = [];
  const views = [0, 1, 2].map((i) => keepLoaded("short", () => gone.push(i)));
  for (const v of views) {
    v.shown();
    v.hidden();
  }
  views[2].shown();
  expect(gone).toEqual([]);
  setMemoryState({ totalMb: 16_000, pressure: 2 });
  expect(gone).toEqual([0, 1]);
  setMemoryState({ totalMb: 16_000, pressure: 0 });
});
