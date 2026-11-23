// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TouchEvent } from "react";
import { useLongPress } from "./useLongPress";

const touch = (x: number, y: number) =>
  ({ touches: [{ clientX: x, clientY: y }] }) as unknown as TouchEvent;

describe("useLongPress", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("hands a held touch's point to onHold and swallows the click after it", () => {
    const onHold = vi.fn();
    const { result } = renderHook(() => useLongPress(onHold));
    act(() => result.current.handlers.onTouchStart(touch(40, 120)));
    act(() => vi.advanceTimersByTime(500));
    expect(onHold).toHaveBeenCalledWith({ x: 40, y: 120 });
    expect(result.current.at).toBeNull();
    // Nor does the lift tap: its mousedown would close what the hold opened.
    const lift = { cancelable: true, preventDefault: vi.fn() };
    act(() =>
      result.current.handlers.onTouchEnd(lift as unknown as TouchEvent),
    );
    expect(lift.preventDefault).toHaveBeenCalled();
    expect(result.current.consumeClick()).toBe(true);
    expect(result.current.consumeClick()).toBe(false);
  });

  it("lets a touch that moves away scroll, not hold", () => {
    const onHold = vi.fn();
    const { result } = renderHook(() => useLongPress(onHold));
    act(() => result.current.handlers.onTouchStart(touch(40, 120)));
    act(() => result.current.handlers.onTouchMove(touch(40, 160)));
    act(() => vi.advanceTimersByTime(500));
    expect(onHold).not.toHaveBeenCalled();
    expect(result.current.consumeClick()).toBe(false);
  });
});
