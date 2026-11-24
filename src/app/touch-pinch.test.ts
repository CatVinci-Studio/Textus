// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { listenToTouchPinch } from "./touch-pinch";

function fingers(type: string, apart: number, count = 2): Event {
  const event = new Event(type, { cancelable: true });
  const touches = [
    { clientX: 100, clientY: 200 },
    { clientX: 100 + apart, clientY: 200 },
  ].slice(0, count);
  Object.assign(event, { touches });
  window.dispatchEvent(event);
  return event;
}

it("reads two fingers' spread as a pinch's scale about their middle", () => {
  const start = vi.fn(() => true);
  const change = vi.fn();
  const end = vi.fn();
  const stop = listenToTouchPinch(window, { start, change, end });
  fingers("touchstart", 100);
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({ clientX: 150, clientY: 200, scale: 1 }),
  );
  const move = fingers("touchmove", 200);
  expect(change).toHaveBeenLastCalledWith({
    clientX: 200,
    clientY: 200,
    scale: 2,
  });
  // Passive: touch-action keeps the page from panning and zooming.
  expect(move.defaultPrevented).toBe(false);
  fingers("touchend", 0, 1);
  expect(end).toHaveBeenCalledWith(expect.objectContaining({ scale: 2 }));
  stop();
});

it("leaves a pinch the zoom doesn't take, and one finger, to the page", () => {
  const change = vi.fn();
  const stop = listenToTouchPinch(window, {
    start: () => false,
    change,
    end: vi.fn(),
  });
  fingers("touchstart", 100);
  expect(fingers("touchmove", 200).defaultPrevented).toBe(false);
  fingers("touchstart", 0, 1);
  expect(fingers("touchmove", 0, 1).defaultPrevented).toBe(false);
  expect(change).not.toHaveBeenCalled();
  stop();
});

it("listens to touchmove passively, so a one-finger scroll never waits on it", () => {
  const added = vi.spyOn(window, "addEventListener");
  const stop = listenToTouchPinch(window, {
    start: () => true,
    change: vi.fn(),
    end: vi.fn(),
  });
  expect(added).toHaveBeenCalledWith("touchmove", expect.any(Function), {
    passive: true,
  });
  added.mockRestore();
  stop();
});
