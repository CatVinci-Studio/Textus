// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyInsets } from "./mobile-viewport";

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
