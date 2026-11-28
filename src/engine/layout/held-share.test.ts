// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { heldShare, holdShare, useHeldShare, withHeld } from "./held-share";
import { pairLayout } from "./ops";
import type { Branch } from "./tree";
import { act, renderHook } from "@testing-library/react";

let queued: FrameRequestCallback[] = [];
const frame = () => {
  const due = queued;
  queued = [];
  for (const cb of due) cb(0);
};

beforeEach(() => {
  queued = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queued.push(cb);
    return queued.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    queued = [];
  });
});

afterEach(() => {
  holdShare(null);
  vi.unstubAllGlobals();
});

describe("a divider's held share", () => {
  it("redraws the islands at most once a frame, however fast the pointer", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useHeldShare();
    });
    renders = 0;
    act(() => {
      holdShare({ path: [], index: 0, share: 0.3 });
      holdShare({ path: [], index: 0, share: 0.35 });
      holdShare({ path: [], index: 0, share: 0.4 });
    });
    expect(renders).toBe(0);
    act(frame);
    expect(renders).toBe(1);
    expect(result.current?.share).toBe(0.4);
    // Let go: drawn from the model at once.
    act(() => holdShare(null));
    expect(result.current).toBeNull();
    expect(heldShare()).toBeNull();
  });

  it("lays the islands out at the share held, the model untouched", () => {
    const layout = pairLayout("row", "a", "b");
    const drawn = withHeld(layout, { path: [], index: 0, share: 0.3 });
    const sizes = (drawn.root as Branch).sizes;
    expect(sizes[0] / (sizes[0] + sizes[1])).toBeCloseTo(0.3, 5);
    expect((layout.root as Branch).sizes).toEqual([0.5, 0.5]);
    expect(withHeld(layout, null)).toBe(layout);
  });
});
