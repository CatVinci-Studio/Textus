// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { watchTheme, webviewThemeCss } from "./theme-vars";

describe("webviewThemeCss", () => {
  afterEach(() => document.documentElement.removeAttribute("style"));

  it("hands a plugin the window's motion with its colours", () => {
    const root = document.documentElement.style;
    root.setProperty("--ui-bg", "#fff");
    root.setProperty("--dur-medium", "250ms");
    root.setProperty("--motion-distance-sm", "0px");
    const css = webviewThemeCss();
    expect(css).toContain("--ui-bg: #fff;");
    expect(css).toContain("--dur-medium: 250ms;");
    // Reduced motion's distances come along as they are.
    expect(css).toContain("--motion-distance-sm: 0px;");
  });
});

describe("watchTheme", () => {
  it("tells plugins of a theme change before the window paints it, once per batch", async () => {
    // No frame ever comes: the post must not wait for one.
    const frame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => 0);
    const heard = vi.fn();
    const stop = watchTheme(heard);
    const root = document.documentElement;
    root.setAttribute("data-theme", "dark");
    root.setAttribute("data-content-theme", "paper");
    await new Promise((done) => setTimeout(done, 0));
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    frame.mockRestore();
    root.removeAttribute("data-theme");
    root.removeAttribute("data-content-theme");
  });
});
