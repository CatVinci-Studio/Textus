// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResizeHandle } from "./ResizeHandle";

afterEach(cleanup);

function renderHandle(edge: "left" | "right") {
  const onResize = vi.fn();
  const onReset = vi.fn();
  render(
    <ResizeHandle
      className="test-resizer"
      edge={edge}
      width={240}
      min={180}
      max={480}
      onResize={onResize}
      onReset={onReset}
      label="Resize"
    />,
  );
  const handle = screen.getByRole("separator", { name: "Resize" });
  // jsdom has no pointer capture.
  handle.setPointerCapture = () => {};
  return { handle, onResize, onReset };
}

describe("a side panel's resize handle", () => {
  it("is a focusable vertical separator with its bounds", () => {
    const { handle } = renderHandle("right");
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("aria-valuenow", "240");
    expect(handle).toHaveAttribute("aria-valuemin", "180");
    expect(handle).toHaveAttribute("aria-valuemax", "480");
    expect(handle).toHaveAttribute("tabindex", "0");
  });

  it("widens toward its edge with the arrow keys, remembering each step", () => {
    const right = renderHandle("right");
    fireEvent.keyDown(right.handle, { key: "ArrowRight" });
    fireEvent.keyDown(right.handle, { key: "ArrowLeft" });
    expect(right.onResize.mock.calls).toEqual([
      [260, true],
      [220, true],
    ]);
    cleanup();
    const left = renderHandle("left");
    fireEvent.keyDown(left.handle, { key: "ArrowLeft" });
    expect(left.onResize).toHaveBeenCalledWith(260, true);
  });

  it("goes to its bounds with Home and End", () => {
    const { handle, onResize } = renderHandle("right");
    fireEvent.keyDown(handle, { key: "Home" });
    fireEvent.keyDown(handle, { key: "End" });
    expect(onResize.mock.calls).toEqual([
      [180, true],
      [480, true],
    ]);
  });

  it("follows a drag live and remembers where it lets go", () => {
    const { handle, onResize } = renderHandle("right");
    fireEvent.pointerDown(handle, { button: 0, clientX: 240, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 280, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 300, pointerId: 1 });
    expect(onResize.mock.calls).toEqual([
      [280, false],
      [300, false],
      [300, true],
    ]);
  });

  it("drags the other way on a left edge", () => {
    const { handle, onResize } = renderHandle("left");
    fireEvent.pointerDown(handle, { button: 0, clientX: 800, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 760, pointerId: 1 });
    expect(onResize).toHaveBeenLastCalledWith(280, false);
  });

  it("resets on a double click", () => {
    const { handle, onReset } = renderHandle("right");
    fireEvent.doubleClick(handle);
    expect(onReset).toHaveBeenCalled();
  });
});
