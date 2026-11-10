import { expect, test } from "@playwright/test";
import {
  aligned,
  firstShownShare,
  maxStep,
  sameWidth,
  startsFromZero,
  steadyGap,
  worst,
  type Frame,
  type FrameBox,
} from "./claims";

// The checks the frame-by-frame flows (frames.spec.ts) rest on, held to
// recordings written by hand: no page, so they run with every e2e run.

function box(left: number, width: number, more: Partial<FrameBox> = {}) {
  return {
    left,
    top: 0,
    right: left + width,
    bottom: 100,
    width,
    height: 100,
    opacity: 1,
    shownWidth: width,
    ...more,
  };
}

/** Frames 16 ms apart from each one's boxes. */
function recording(...frames: Frame["boxes"][]): Frame[] {
  return frames.map((boxes, i) => ({ t: i * 16, boxes }));
}

test.describe("aligned", () => {
  test("passes blocks whose edge is level in every frame, moving or not", () => {
    const frames = recording(
      { sheet: box(100, 400), row: box(100, 400) },
      { sheet: box(160, 340), row: box(160.6, 339.4) },
    );
    expect(aligned(frames, "sheet", "row", "left")).toEqual([]);
    expect(aligned(frames, "sheet", "row", "right")).toEqual([]);
  });

  test("names the frame an edge left the other's, and by how much", () => {
    const frames = recording(
      { sheet: box(100, 400), row: box(100, 400) },
      { sheet: box(100, 400), row: box(140, 360) },
      { sheet: box(140, 360), row: box(140, 360) },
    );
    expect(aligned(frames, "sheet", "row", "left")).toEqual([
      { frame: 1, t: 16, by: 40 },
    ]);
  });

  test("skips frames one of them isn't in the page", () => {
    const frames = recording({ sheet: box(0, 10), row: null });
    expect(aligned(frames, "sheet", "row", "left")).toEqual([]);
  });
});

test.describe("steadyGap", () => {
  test("passes two islands that move as one", () => {
    const frames = recording(
      { old: box(0, 800), added: box(808, 0) },
      { old: box(0, 600), added: box(608, 200) },
      { old: box(0, 400), added: box(408, 400) },
    );
    expect(steadyGap(frames, ["old", "right"], ["added", "left"])).toEqual([]);
  });

  test("catches one that is at its place before the other gave way", () => {
    const frames = recording(
      { old: box(0, 800), added: box(408, 400) },
      { old: box(0, 600), added: box(408, 400) },
      { old: box(0, 400), added: box(408, 400) },
    );
    const misses = steadyGap(frames, ["old", "right"], ["added", "left"]);
    expect(misses.map((miss) => miss.frame)).toEqual([0, 1]);
    expect(worst(misses)?.by).toBe(400);
  });
});

test.describe("maxStep", () => {
  test("is the furthest an edge went in one frame", () => {
    const frames = recording(
      { a: box(0, 100) },
      { a: box(10, 100) },
      { a: box(50, 100) },
    );
    expect(maxStep(frames, "a")).toBe(40);
  });

  test("spreads a move over the frames a dropped one spans", () => {
    const frames: Frame[] = [
      { t: 0, boxes: { a: box(0, 100) } },
      { t: 50, boxes: { a: box(60, 100) } },
    ];
    expect(maxStep(frames, "a")).toBe(20);
  });
});

test.describe("startsFromZero", () => {
  test("passes a block that grows in from no width", () => {
    const frames = recording(
      { added: null },
      { added: box(800, 20) },
      { added: box(400, 420) },
    );
    expect(startsFromZero(frames, "added")).toBe(true);
  });

  test("passes a block at its size but clipped away", () => {
    const frames = recording(
      { added: box(400, 400, { shownWidth: 0 }) },
      { added: box(400, 400) },
    );
    expect(startsFromZero(frames, "added")).toBe(true);
  });

  test("fails a block that fades in at its full size", () => {
    const frames = recording(
      { added: box(400, 400, { opacity: 0 }) },
      { added: box(400, 400, { opacity: 0.3 }) },
      { added: box(400, 400) },
    );
    expect(firstShownShare(frames, "added")).toBe(1);
    expect(startsFromZero(frames, "added")).toBe(false);
  });

  test("fails a block that never shows", () => {
    expect(startsFromZero(recording({ added: null }), "added")).toBe(false);
  });
});

test.describe("sameWidth", () => {
  test("passes tabs that only move", () => {
    const frames = recording(
      { one: box(0, 120), two: box(122, 120) },
      { one: box(0, 120), two: box(100, 120) },
    );
    expect(sameWidth(frames, ["one", "two"])).toEqual([]);
  });

  test("names the tab that changed width, and the frame", () => {
    const frames = recording(
      { one: box(0, 120), two: box(122, 120) },
      { one: box(0, 120), two: box(122, 138) },
    );
    expect(sameWidth(frames, ["one", "two"])).toEqual([
      { frame: 1, t: 16, name: "two", by: 18 },
    ]);
  });
});
