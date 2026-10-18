import { describe, expect, it } from "vitest";
import { highlightBoxes } from "./chat-selection-plugin";

const box = (top: number, bottom: number, left: number, right: number) => ({
  top,
  bottom,
  left,
  right,
});

describe("the chat selection's boxes", () => {
  it("merges a line's fragments and bridges lines over what they share", () => {
    const boxes = highlightBoxes([
      // A second paragraph, then two fragments of the first line (a bold
      // word splits it) and its wrapped second line.
      box(160, 180, 10, 200),
      box(100, 120, 40, 90),
      box(101, 119, 90, 300),
      box(128, 148, 10, 250),
    ]);
    expect(boxes).toEqual([
      box(100, 120, 40, 300),
      box(120, 128, 40, 250),
      box(128, 148, 10, 250),
      box(148, 160, 10, 200),
      box(160, 180, 10, 200),
    ]);
  });

  it("leaves a gap taller than two lines open", () => {
    // Quick Ask's panel under the paragraph it was opened on.
    expect(
      highlightBoxes([box(100, 120, 10, 200), box(300, 320, 10, 200)]),
    ).toHaveLength(2);
  });
});
