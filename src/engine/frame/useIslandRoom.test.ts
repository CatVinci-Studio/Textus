// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The area's spacings are read afresh (a style and layout pass each) only
// when they may have changed: the look, the layout's switches. A resize
// alone, every frame of a dragged edge, reads them as kept.
const reads = vi.hoisted(() => [] as boolean[]);
const looks = vi.hoisted(() => new Set<() => void>());
vi.mock("../tokens/token-px", () => ({
  tokenPx: (_name: string, { fresh = false } = {}) => {
    reads.push(fresh);
    return 10;
  },
}));
vi.mock("../tokens/appearance", () => ({
  onAppearance: (cb: () => void) => {
    looks.add(cb);
    return () => looks.delete(cb);
  },
}));

import { useIslandRoom } from "./useIslandRoom";

let resized: (() => void) | null = null;

beforeEach(() => {
  reads.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        resized = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const area = { current: document.createElement("main") };

describe("the islands' area measure", () => {
  it("reads the spacings afresh first, kept on a resize, afresh on a new look", () => {
    const { rerender } = renderHook(({ key }) => useIslandRoom(area, key), {
      initialProps: { key: "a" },
    });
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every(Boolean)).toBe(true);
    reads.length = 0;
    resized?.();
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.some(Boolean)).toBe(false);
    reads.length = 0;
    for (const cb of looks) cb();
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every(Boolean)).toBe(true);
    reads.length = 0;
    // A layout switch (split, rows, plain): afresh.
    rerender({ key: "b" });
    expect(reads.every(Boolean)).toBe(true);
  });
});
