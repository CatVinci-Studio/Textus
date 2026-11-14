import { describe, expect, it } from "vitest";
import { turned } from "./mobile-viewport";

describe("an iPhone's safe area on its side", () => {
  const upright = { top: 62, right: 0, bottom: 34, left: 0 };

  it("moves the camera's inset from the top to the sides", () => {
    expect(turned(upright, 874, 402)).toEqual({
      top: 0,
      right: 62,
      bottom: 34,
      left: 62,
    });
  });

  it("keeps insets WebKit already turned, an upright phone's, and an iPad's", () => {
    const sides = { top: 0, right: 62, bottom: 21, left: 62 };
    expect(turned(sides, 874, 402)).toEqual(sides);
    expect(turned(upright, 402, 874)).toEqual(upright);
    const ipad = { top: 24, right: 0, bottom: 20, left: 0 };
    expect(turned(ipad, 1210, 834)).toEqual(ipad);
  });
});
