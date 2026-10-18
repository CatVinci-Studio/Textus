import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTabIdleTimers } from "./tab-idle-timers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const timers = (maxWaitMs?: number) =>
  createTabIdleTimers<string>({
    idleMs: 1000,
    maxWaitMs,
    same: (a, b) => a === b,
  });

describe("per-tab idle timers", () => {
  it("fires once typing has rested, with the last snapshot", () => {
    const t = timers();
    const fire = vi.fn();
    t.schedule("a", "1", fire);
    vi.advanceTimersByTime(800);
    t.schedule("a", "12", fire);
    vi.advanceTimersByTime(800);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(fire).toHaveBeenCalledExactlyOnceWith("12");
  });

  it("doesn't restart for an unchanged snapshot, nor write it twice", () => {
    const t = timers();
    const fire = vi.fn();
    t.schedule("a", "x", fire);
    vi.advanceTimersByTime(800);
    t.schedule("a", "x", fire);
    vi.advanceTimersByTime(200);
    t.schedule("a", "x", fire);
    vi.advanceTimersByTime(2000);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("fires by the cap during unbroken typing", () => {
    const t = timers(2500);
    const fire = vi.fn();
    for (let i = 0; i < 5; i++) {
      t.schedule("a", String(i), fire);
      vi.advanceTimersByTime(600);
    }
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("cancel drops a tab's timer and says whether it had one", () => {
    const t = timers();
    const fire = vi.fn();
    t.schedule("a", "x", fire);
    expect(t.cancel("a")).toBe(true);
    expect(t.cancel("a")).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(fire).not.toHaveBeenCalled();
  });
});
