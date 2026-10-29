import { describe, expect, it } from "vitest";
import { keepRotation, splitImageTitle, turnedTitle } from "./image-rotation";
import { readImagePresentation, withImageWidth } from "./image-html";

describe("image rotation metadata", () => {
  it("reads width and rotation from one suffix, in either spelling", () => {
    expect(splitImageTitle("Shot {textus-width=50% textus-rotate=90}")).toEqual(
      { title: "Shot", widthPercent: 50, rotate: 90 },
    );
    expect(splitImageTitle("Shot {levis-width=40%}")).toEqual({
      title: "Shot",
      widthPercent: 40,
      rotate: 0,
    });
    expect(splitImageTitle("Shot {textus-rotate=45}").rotate).toBe(0);
  });

  it("turns in quarter steps and drops the suffix at no turn", () => {
    expect(turnedTitle("Shot", 1)).toBe("Shot {textus-rotate=90}");
    expect(turnedTitle(null, -1)).toBe("{textus-rotate=270}");
    expect(turnedTitle("{textus-rotate=270}", 1)).toBe("");
  });

  it("keeps the rotation when the width changes, and out of the caption", () => {
    const attrs = { src: "a.png", title: "Shot {textus-rotate=90}", width: "" };
    expect(withImageWidth(attrs, 70)).toMatchObject({
      title: "Shot {textus-rotate=90}",
      width: "70%",
    });
    expect(readImagePresentation(attrs.title).title).toBe("Shot");
    expect(keepRotation("{textus-rotate=180}", "")).toBe("{textus-rotate=180}");
  });
});
