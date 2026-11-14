import { describe, expect, it } from "vitest";
import { distribute, type SizeRule } from "./distribute";

const doc = (size = 1): SizeRule => ({
  min: 360,
  size,
  fixed: false,
  priority: "high",
});
const panel = (size = 400): SizeRule => ({
  min: 320,
  size,
  fixed: true,
  priority: "low",
});

describe("distribute", () => {
  it("a panel keeps its pixels, the document takes the rest", () => {
    expect(distribute([doc(), panel()], 1200)).toEqual([800, 400]);
    expect(distribute([doc(), panel()], 1600)).toEqual([1200, 400]);
  });

  it("documents share by their fractions, in whole pixels adding up", () => {
    const sizes = distribute([doc(0.5), doc(0.5), doc(1)], 2001);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(2001);
    [500.25, 500.25, 1000.5].forEach((want, i) =>
      expect(Math.abs(sizes[i] - want)).toBeLessThanOrEqual(1),
    );
  });

  it("short of room, the panel gives way first, down to its minimum", () => {
    expect(distribute([doc(), panel()], 720)).toEqual([360, 360]);
    expect(distribute([doc(), panel()], 680)).toEqual([360, 320]);
  });

  it("past every minimum, everyone shrinks alike", () => {
    const sizes = distribute([doc(), panel()], 340);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(340);
    expect(sizes[0]).toBeGreaterThan(sizes[1]);
  });

  it("past every minimum, one with a floor keeps it, the others give", () => {
    // Two documents in 460: the right one, under the bar's buttons, keeps
    // the 360 its row needs.
    expect(distribute([doc(), { ...doc(), floor: 360 }], 460)).toEqual([
      100, 360,
    ]);
    // Floors that can't all fit are dropped: everyone shrinks alike.
    const both = { ...doc(), floor: 300 };
    const sizes = distribute([both, both], 460);
    expect(sizes).toEqual([230, 230]);
  });

  it("a floor above the minimum holds while the others can still give", () => {
    // Wide window buttons: the right one needs 380, more than its 360 least.
    expect(distribute([doc(), { ...doc(), floor: 380 }], 740)).toEqual([
      360, 380,
    ]);
  });

  it("panels alone fill the row by their widths, each kept to its minimum", () => {
    expect(distribute([panel(400), panel(400)], 900)).toEqual([450, 450]);
    expect(distribute([panel(400), panel(200)], 900)).toEqual([580, 320]);
  });
});
