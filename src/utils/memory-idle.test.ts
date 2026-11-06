// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { IDLE_MS, onMemoryIdle, watchMemoryIdle } from "./memory-idle";

afterEach(() => vi.useRealTimers());

it("gives memory back once the window has been left alone a while, not before", () => {
  vi.useFakeTimers();
  const release = vi.fn();
  onMemoryIdle(release);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  watchMemoryIdle();
  vi.advanceTimersByTime(IDLE_MS * 2);
  expect(release).not.toHaveBeenCalled();
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  window.dispatchEvent(new Event("blur"));
  vi.advanceTimersByTime(IDLE_MS - 1);
  expect(release).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(release).toHaveBeenCalledTimes(1);
  // Back before the time is up: nothing is given back.
  window.dispatchEvent(new Event("blur"));
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  window.dispatchEvent(new Event("focus"));
  vi.advanceTimersByTime(IDLE_MS * 2);
  expect(release).toHaveBeenCalledTimes(1);
});
