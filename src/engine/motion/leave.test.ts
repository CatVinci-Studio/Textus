import { describe, expect, it, vi } from "vitest";
import { removeWhenGone } from "./leave";

describe("removeWhenGone", () => {
  it("takes out at once what has nothing running", () => {
    const remove = vi.fn();
    removeWhenGone(
      { getAnimations: () => [] } as unknown as Element,
      100,
      remove,
    );
    expect(remove).toHaveBeenCalledOnce();
  });

  it("waits for its animations, and only once", async () => {
    let finish!: () => void;
    const finished = new Promise<void>((r) => (finish = r));
    const remove = vi.fn();
    vi.useFakeTimers();
    removeWhenGone(
      { getAnimations: () => [{ finished }] } as unknown as Element,
      100,
      remove,
    );
    expect(remove).not.toHaveBeenCalled();
    finish();
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("goes after its time if the animation never ends", () => {
    vi.useFakeTimers();
    const remove = vi.fn();
    removeWhenGone(
      {
        getAnimations: () => [{ finished: new Promise(() => {}) }],
      } as unknown as Element,
      100,
      remove,
    );
    vi.advanceTimersByTime(149);
    expect(remove).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    vi.useRealTimers();
    expect(remove).toHaveBeenCalledOnce();
  });
});
