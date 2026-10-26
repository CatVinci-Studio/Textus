// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { webviewThemeCss } from "./theme-vars";

describe("webviewThemeCss", () => {
  afterEach(() => document.documentElement.removeAttribute("style"));

  it("hands a plugin the window's motion with its colours", () => {
    const root = document.documentElement.style;
    root.setProperty("--bg", "#fff");
    root.setProperty("--dur-medium", "250ms");
    root.setProperty("--motion-distance-sm", "0px");
    const css = webviewThemeCss();
    expect(css).toContain("--bg: #fff;");
    expect(css).toContain("--dur-medium: 250ms;");
    // Reduced motion's distances come along as they are.
    expect(css).toContain("--motion-distance-sm: 0px;");
  });
});
