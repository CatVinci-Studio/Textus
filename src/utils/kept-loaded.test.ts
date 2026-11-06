// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { KEEP_HIDDEN_MS, keepLoaded } from "./kept-loaded";

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

it("keeps one held while it must stay, and lets it go once it needn't", () => {
  vi.useFakeTimers();
  const unload = vi.fn();
  let held = true;
  const view = keepLoaded("held", unload, { hold: () => held });
  view.shown();
  view.hidden();
  vi.advanceTimersByTime(KEEP_HIDDEN_MS * 3);
  expect(unload).not.toHaveBeenCalled();
  held = false;
  vi.advanceTimersByTime(KEEP_HIDDEN_MS);
  expect(unload).toHaveBeenCalledTimes(1);
});
