// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyInsets, turned } from "./mobile-viewport";

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

describe("the safe area at launch", () => {
  it("leaves iOS on env() until WebKit knows the insets, then takes them", () => {
    const style = document.createElement("div").style;
    style.setProperty("--native-safe-top", "0px");
    applyInsets({ top: 0, right: 0, bottom: 0, left: 0 }, style, true);
    expect(style.getPropertyValue("--native-safe-top")).toBe("");
    applyInsets({ top: 62, right: 0, bottom: 34, left: 0 }, style, true);
    expect(style.getPropertyValue("--native-safe-top")).toBe("62px");
  });

  it("takes Android's zeros as they are", () => {
    const style = document.createElement("div").style;
    applyInsets({ top: 0, right: 0, bottom: 0, left: 0 }, style, false);
    expect(style.getPropertyValue("--native-safe-top")).toBe("0px");
  });
});
