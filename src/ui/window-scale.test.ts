// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { installWindowScale, windowScale } from "./window-scale";

describe("windowScale", () => {
  it("is 1 for a small window, grows in a straight line, and stops at 1.35", () => {
    expect(windowScale(900)).toBe(1);
    expect(windowScale(1200)).toBe(1);
    expect(windowScale(1520)).toBeCloseTo(1.1);
    expect(windowScale(1840)).toBeCloseTo(1.2);
    expect(windowScale(2560)).toBe(1.35);
  });

  it("follows the window as it is resized", () => {
    installWindowScale();
    const root = document.documentElement;
    Object.defineProperty(window, "innerWidth", {
      value: 1840,
      configurable: true,
    });
    window.dispatchEvent(new Event("resize"));
    expect(root.style.getPropertyValue("--window-scale")).toBe("1.200");
  });
});
