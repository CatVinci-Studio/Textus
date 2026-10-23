// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRevealedText } from "./useRevealedText";

let motion = true;
vi.mock("../../ui/motion", () => ({ motionAllowed: () => motion }));

const reply = "The reply streams in, ".repeat(20);

function stream() {
  return renderHook(
    ({ text, live }: { text: string; live: boolean }) =>
      useRevealedText(text, live),
    { initialProps: { text: "", live: true } },
  );
}

describe("useRevealedText", () => {
  beforeEach(() => {
    motion = true;
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
    });
  });
  afterEach(() => vi.useRealTimers());

  it("reveals a received chunk over several frames, never past it", () => {
    const { result, rerender } = stream();
    rerender({ text: reply, live: true });
    const seen: number[] = [];
    for (let i = 0; i < 90; i++) {
      act(() => vi.advanceTimersToNextFrame());
      expect(reply.startsWith(result.current)).toBe(true);
      seen.push(result.current.length);
    }
    expect(seen[0]).toBeLessThan(reply.length / 4);
    expect(new Set(seen).size).toBeGreaterThan(10);
    expect(result.current).toBe(reply);
  });

  it("shows the whole text the moment the stream ends, stopped or not", () => {
    const { result, rerender } = stream();
    rerender({ text: reply, live: true });
    act(() => vi.advanceTimersToNextFrame());
    expect(result.current.length).toBeLessThan(reply.length);
    rerender({ text: reply, live: false });
    expect(result.current).toBe(reply);
  });

  it("starts the next stream from nothing, not from the last reply", () => {
    const { result, rerender } = stream();
    rerender({ text: reply, live: true });
    act(() => vi.advanceTimersByTime(1000));
    rerender({ text: "", live: false });
    rerender({ text: "", live: true });
    expect(result.current).toBe("");
  });

  it("with motion reduced, shows what has arrived without pacing it", () => {
    motion = false;
    const { result, rerender } = stream();
    rerender({ text: reply, live: true });
    expect(result.current).toBe(reply);
  });
});
