// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { checkColors, gradientStops, rgbOf } from "./plugin-colors-check";
import {
  clearPluginColors,
  forgetPluginColors,
  setPluginColors,
} from "./plugin-colors";
import { CUSTOM_CSS_STYLE_ID, PLUGIN_COLORS_STYLE_ID } from "./style-ids";

// jsdom draws no canvas: one that reads back the colour it was given, for
// the contrast checks (hex and rgb() are all these tests use).
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function () {
    let fill = "#000";
    const parse = (v: string): number[] => {
      const hex = /^#([0-9a-f]{6})$/i.exec(v);
      if (hex)
        return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
      const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(v);
      return rgb ? rgb.slice(1).map(Number) : [0, 0, 0];
    };
    return {
      clearRect() {},
      fillRect() {},
      set fillStyle(v: string) {
        fill = v;
      },
      get fillStyle() {
        return fill;
      },
      getImageData: () => ({ data: [...parse(fill), 255] }),
    } as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

const applied = () =>
  document.getElementById(PLUGIN_COLORS_STYLE_ID)?.textContent ?? "";

afterEach(() => {
  forgetPluginColors("a.one");
  forgetPluginColors("b.two");
  document.getElementById(CUSTOM_CSS_STYLE_ID)?.remove();
});

describe("a plugin's colours", () => {
  it("take colours, and a gradient for the frame's paint only", () => {
    expect(checkColors({ "--ui-accent": "#c06" })).toEqual({
      "--ui-accent": "rgb(204, 0, 102)",
    });
    expect(
      checkColors({
        "--ui-frame-paint": "linear-gradient(120deg, #f3d9c4, #d6dcec)",
      })["--ui-frame-paint"],
    ).toMatch(/^linear-gradient\(/);
    expect(() =>
      checkColors({ "--ui-accent": "linear-gradient(red, blue)" }),
    ).toThrow();
  });

  it("refuse what isn't a colour of their own, or a variable not opened", () => {
    for (const value of [
      "url(https://x.test/a.png)",
      "var(--ui-text)",
      "inherit",
      "red; background: url(x)",
      "linear-gradient(red, url(x))",
      "\\75 rl(x)",
    ])
      expect(() => checkColors({ "--ui-frame-paint": value })).toThrow();
    expect(() => checkColors({ "--ui-border": "#000" })).toThrow();
    expect(() => checkColors({ "--font-sans": "serif" })).toThrow();
  });

  it("read a mixed colour as the window computes it", () => {
    expect(rgbOf("color(srgb 1 0.5 0)")).toEqual([255, 128, 0]);
    expect(rgbOf("color(srgb 1 0.5 0 / 0.5)")).toBeNull();
  });

  it("read a gradient's colour stops", () => {
    expect(
      gradientStops("linear-gradient(120deg, #ff0000 10%, rgb(0, 0, 255) 90%)"),
    ).toEqual([
      [255, 0, 0],
      [0, 0, 255],
    ]);
  });

  it("are layered after the theme, before the user's CSS, and go with the plugin", () => {
    const custom = document.createElement("style");
    custom.id = CUSTOM_CSS_STYLE_ID;
    document.head.appendChild(custom);
    setPluginColors("a.one", { "--tone-blue": "#0000ff" });
    const style = document.getElementById(PLUGIN_COLORS_STYLE_ID);
    expect(style?.nextElementSibling).toBe(custom);
    expect(applied()).toContain("--tone-blue: rgb(0, 0, 255) !important");
    forgetPluginColors("a.one");
    expect(document.getElementById(PLUGIN_COLORS_STYLE_ID)).toBeNull();
  });

  it("let the plugin last by id win, and come off one layer at a time", () => {
    const later = setPluginColors("b.two", { "--tone-red": "#110000" });
    setPluginColors("a.one", { "--tone-red": "#220000" });
    expect(applied()).toContain("--tone-red: rgb(17, 0, 0)");
    clearPluginColors("b.two", later);
    expect(applied()).toContain("--tone-red: rgb(34, 0, 0)");
    // Another plugin's layer is not one's own to clear.
    clearPluginColors("b.two", "a.one#1");
    expect(applied()).toContain("--tone-red");
  });

  it("keep one scheme's colours to that scheme", () => {
    setPluginColors("a.one", { "--tone-pink": "#ff00ff" }, "dark");
    expect(applied()).not.toContain("--tone-pink");
  });

  it("keep text readable on its page", () => {
    setPluginColors("a.one", {
      "--doc-bg": "#ffffff",
      "--doc-text": "#eeeeee",
    });
    const text = /--doc-text: rgb\((\d+), (\d+), (\d+)\)/.exec(applied());
    expect(text).not.toBeNull();
    // Pulled toward ink: far darker than the #eee asked for.
    expect(Number(text![1])).toBeLessThan(120);
  });

  it("keep the interface's text readable on every colour of the paint", () => {
    setPluginColors("a.one", {
      "--ui-bg": "#ffffff",
      "--ui-text": "#999999",
      "--ui-frame-paint": "linear-gradient(#ffffff, #dddddd)",
    });
    const text = /--ui-text: rgb\((\d+)/.exec(applied());
    expect(Number(text![1])).toBeLessThan(110);
    // The derived ones come with it, over whatever the theme pinned.
    expect(applied()).toContain("--ui-border");
  });
});
